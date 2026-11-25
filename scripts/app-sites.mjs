/* WHERE EACH APP LIVES ON THE WEB - for measuring how much it is used, not for
   opening it (that is AMV_APP_WEB in integrations-view.js, which this falls
   back to). scripts/app-reach.mjs looks each host up in the Chrome UX Report.

   The host is the app's own: mail.google.com, not google.com. A product on a
   shared domain is matched on its own host only - Google Tasks must not be
   ranked as google.com. `null` means the app has no website of its own to
   measure (SMS, iMessage, a file format, an app that only runs on a device),
   and it is ranked by nothing rather than by a guess.

   HOW A HOST IS MATCHED. The Chrome UX Report lists only sites the public can
   reach, so an app's signed-in address (app.asana.com) is often not in it and
   its own site (asana.com) is what is measured. So a bare domain that belongs
   to the app alone counts with all its subdomains; a host on a domain shared
   by a company's many products (SHARED: google.com, microsoft.com, adobe.com
   ...) or any longer host counts exactly. Several hosts may be listed; the
   best-ranked one is the app's.

   TENANTS: products that live on each customer's own subdomain (a school's
   Canvas at school.instructure.com, a team's Jira at team.atlassian.net) are
   measured as the best-ranked of those subdomains. Nothing else is: a
   company's main site never stands in for one of its products. */
export const SHARED = new Set(['google.com', 'microsoft.com', 'live.com', 'cloud.microsoft', 'office.com', 'adobe.com', 'apple.com', 'icloud.com',
  'amazon.com', 'yahoo.com', 'yahoo.co.jp', 'aol.com', 'atlassian.com', 'atlassian.net', 'naver.com', 'daum.net', 'qq.com', 'sina.com.cn',
  'yandex.ru', 'yandex.com.tr', 'mail.ru', 'zoho.com', 'uol.com.br', 'orange.fr', 'free.fr', 't-online.de', 'libero.it', 'rediff.com',
  'xfinity.com', 'spectrum.net', 'bt.com', 'telstra.com', 'samsung.com', 'meta.com', 'facebook.com', 'serif.com', 'garmin.com']);
export const TENANTS = new Set(['atlassian.net', 'instructure.com', 'myworkday.com', 'zendesk.com', 'freshdesk.com',
  'brightspace.com', 'blackboard.com', 'powerschool.com', 'bamboohr.com', 'greenhouse.io', 'lever.co', 'workable.com']);
export const APP_SITES = {
  // Brands with a site per country: 'brand.*' is the brand's own domain in
  // any country (amazon.com.br, ebay.de) with its subdomains (uk.indeed.com) -
  // except Amazon, whose subdomains are other products (ROOT_ONLY in
  // app-reach.mjs), so its shop is not credited with AWS or Prime Video.
  'Amazon': 'amazon.*', 'eBay': 'ebay.*', 'Walmart': 'walmart.*', 'Mercado Libre': ['mercadolibre.*', 'mercadolivre.*'],
  'Mercado Pago': 'mercadopago.*', 'Shopee': 'shopee.*', 'Lazada': 'lazada.*', 'Zalando': 'zalando.*', 'IKEA': 'ikea.*',
  'Rakuten': 'rakuten.*', 'Deliveroo': 'deliveroo.*', 'foodpanda': 'foodpanda.*', 'Just Eat': ['just-eat.*', 'justeat.*'],
  'Vinted': 'vinted.*', 'Indeed': 'indeed.*', 'Glassdoor': 'glassdoor.*', 'Expedia': 'expedia.*', 'Hotels.com': 'hotels.*',
  'Tripadvisor': 'tripadvisor.*', 'Skyscanner': 'skyscanner.*', 'Kayak': 'kayak.*', 'Uber Eats': 'ubereats.*', 'Booking.com': 'booking.*',
  'Costco': 'costco.*', 'Bolt': 'bolt.eu', 'Trading 212': 'trading212.*', 'Klarna': 'klarna.*', 'Revolut': 'revolut.*',
  // Overrides of AMV_APP_WEB where the measured site is another host
  'Microsoft Teams': ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'], 'OneNote': ['onenote.cloud.microsoft', 'onenote.com'],
  'Microsoft Planner': 'planner.cloud.microsoft', 'Superhuman': 'superhuman.com', 'Spark Mail': ['sparkmailapp.com', 'readdle.com'],
  'Front': ['front.com', 'frontapp.com'], 'Seek': ['seek.com', 'seek.com.au', 'seek.co.nz'], 'ClickUp': 'clickup.com', 'Things': 'culturedcode.com',
  'Adobe Illustrator': 'illustrator.adobe.com', 'Adobe Express': ['express.adobe.com', 'new.express.adobe.com'],
  'Max': ['max.com', 'hbomax.com'], 'Plex': 'plex.tv', 'Riverside': 'riverside.fm', 'Tidal': 'tidal.com', 'Pocket Casts': 'pocketcasts.com',
  'Threads': ['threads.com', 'threads.net'], 'DiDi': 'didiglobal.com',
  'Rappi': ['rappi.com', 'rappi.com.mx', 'rappi.com.co', 'rappi.com.br', 'rappi.cl', 'rappi.com.ar', 'rappi.com.pe'],
  'Pipedrive': 'pipedrive.com', 'Google Analytics': 'analytics.google.com', 'Looker Studio': 'lookerstudio.google.com',
  'Sprout Social': 'sproutsocial.com', 'Segment': 'segment.com',
  // Email
  'Gmail': 'mail.google.com', 'Outlook and Hotmail': 'outlook.live.com', 'Mail worldwide': null,
  'Yahoo Mail': 'mail.yahoo.com', 'iCloud Mail': 'icloud.com', 'AOL Mail': 'mail.aol.com', 'Zoho Mail': 'mail.zoho.com',
  'Fastmail': 'fastmail.com', 'GMX': 'gmx.net', 'mail.com': 'mail.com', 'QQ Mail (QQ邮箱)': 'mail.qq.com',
  'Sina Mail (新浪邮箱)': 'mail.sina.com.cn', 'Alibaba Mail (阿里邮箱)': 'qiye.aliyun.com', 'Naver Mail (네이버 메일)': 'mail.naver.com',
  'Daum / Hanmail (다음 한메일)': 'mail.daum.net', 'Yahoo! Japan Mail (ヤフーメール)': 'mail.yahoo.co.jp',
  'Yandex Mail (Яндекс Почта)': 'mail.yandex.ru', 'Yandex Mail (Yandex Posta)': 'mail.yandex.com.tr', 'Mail.ru (Почта Mail.ru)': 'e.mail.ru',
  'UKR.NET': 'mail.ukr.net', 'WEB.DE': 'web.de', 'T-Online': 'email.t-online.de', 'Bluewin (Swisscom)': null,
  'Orange': ['mail01.orange.fr', 'mail02.orange.fr', 'messagerie.orange.fr'], 'Free': 'webmail.free.fr', 'La Poste': 'laposte.net', 'Telenet': 'mail.telenet.be',
  'KPN Mail': 'webmail.kpnmail.nl', 'Ziggo': null, 'Freedom / XS4ALL': 'webmail.xs4all.nl', 'Libero Mail': ['mail.libero.it', 'login.libero.it'],
  'Tiscali': 'mail.tiscali.it', 'SAPO Mail': 'mail.sapo.pt', 'Seznam.cz': 'email.seznam.cz', 'WP.pl Poczta': 'poczta.wp.pl',
  'Onet Poczta': 'poczta.onet.pl', 'Interia Poczta': 'poczta.interia.pl', 'Telia': null, 'Rediffmail Pro': ['mail.rediff.com', 'f4email.rediff.com'],
  'UOL Mail': ['email.uol.com.br', 'webmailpro.uol.com.br'], 'BOL Mail': 'email.bol.uol.com.br', 'Mweb': null, 'Xfinity (Comcast)': 'login.xfinity.com',
  'AT&T / Yahoo hosted': 'currently.att.yahoo.com', 'Spectrum (Charter)': ['mail.spectrum.net', 'mail3.spectrum.net'], 'Cox (now Yahoo Mail)': null,
  'Bell / Sympatico': null, 'Shaw / Rogers': null, 'TELUS': null, 'Telstra (BigPond)': 'email.telstra.com',
  'BT Mail': 'email.bt.com',
  // Calendar
  'Google Calendar': 'calendar.google.com', 'Outlook Calendar': 'outlook.live.com', 'Apple iCloud Calendar': 'icloud.com',
  'Any other calendar': null, 'Calendly': 'calendly.com', 'Fantastical': 'flexibits.com',
  // Messaging
  'Telegram': 'telegram.org', 'Text messages (SMS)': null, 'Slack': 'slack.com', 'Discord': 'discord.com',
  'Zoom': 'zoom.us', 'Signal': 'signal.org', 'LINE': 'line.me', 'KakaoTalk': ['kakaocorp.com', 'kakao.com'], 'iMessage': null,
  // Files
  'Google Drive': 'drive.google.com', 'Google Docs': 'docs.google.com', 'Google Sheets': 'docs.google.com', 'Google Slides': 'docs.google.com',
  'Excel and CSV': null, 'Word': 'word.cloud.microsoft', 'PowerPoint': 'powerpoint.cloud.microsoft', 'Dropbox': 'dropbox.com',
  'OneDrive': 'onedrive.live.com', 'Box': 'box.com', 'Apple Notes': null, 'Obsidian': 'obsidian.md',
  // Money
  'Bank account': null, 'PayPal': 'paypal.com', 'Stripe': 'stripe.com', 'Wise': 'wise.com', 
  'Venmo': 'venmo.com', 'Cash App': 'cash.app', 'Zelle': ['zelle.com', 'zellepay.com'], 'Coinbase': 'coinbase.com', 'Kraken': 'kraken.com',
  'Robinhood': 'robinhood.com', 'Interactive Brokers': 'interactivebrokers.com', 'eToro': 'etoro.com', 
  'Monzo': 'monzo.com', 'N26': 'n26.com', 'Nubank': 'nubank.com.br', 'Chime': 'chime.com', 
  'PhonePe': 'phonepe.com', 'Google Pay': 'pay.google.com', 'M-Pesa': 'safaricom.co.ke', 
  'GCash': 'gcash.com', 'QuickBooks': 'quickbooks.intuit.com', 'Xero': 'xero.com', 'FreshBooks': 'freshbooks.com',
  'Square': 'squareup.com', 'YNAB': 'ynab.com', 'Splitwise': 'splitwise.com', 'Expensify': 'expensify.com',
  // Developers
  'GitHub': 'github.com', 'VS Code': 'code.visualstudio.com', 'GitLab': 'gitlab.com', 'Linear': 'linear.app',
  'Jira': 'atlassian.net', 'Vercel': 'vercel.com', 'Supabase': 'supabase.com', 'Postman': 'postman.com', 'JetBrains IDEs': 'jetbrains.com',
  // School
  'Canvas LMS': 'instructure.com', 'Google Classroom': 'classroom.google.com', 'Moodle': 'moodle.org', 'Blackboard': 'blackboard.com',
  'Brightspace': 'brightspace.com', 'PowerSchool': 'powerschool.com', 'Anki': 'ankiweb.net', 'Notability': 'notability.com',
  'GoodNotes': 'goodnotes.com', 'Photomath': 'photomath.com',
  // Jobs
  // Home
  'Everyday life where you live': null, 'AMV around the world': null, 'Google Home': 'home.google.com', 'Amazon Alexa': 'alexa.amazon.com',
  'Apple Home': null, 'SmartThings': 'smartthings.com', 'Philips Hue': 'philips-hue.com', 'Google Nest': 'home.nest.com',
  'Ring': 'ring.com', 'Tesla': 'tesla.com', 'Home Assistant': 'home-assistant.io', 'Sonos': 'sonos.com', 'ecobee': 'ecobee.com',
  'Arlo': 'arlo.com', 'TP-Link Kasa': 'kasasmart.com', 'iRobot': 'irobot.com',
  // Work
  'Notion': ['notion.com', 'notion.so'], 'Asana': 'asana.com', 'Monday.com': 'monday.com', 'Todoist': 'todoist.com',
  'Google Tasks': 'tasks.google.com', 'Miro': 'miro.com', 'Confluence': 'atlassian.net', 'Things': 'culturedcode.com', 'Craft': 'craft.do',
  // Design
  'Canva': 'canva.com', 'Figma': 'figma.com', 'Adobe Photoshop': 'photoshop.adobe.com', 'Adobe Illustrator': 'illustrator.adobe.com',
  'Adobe Lightroom': 'lightroom.adobe.com', 'Procreate': 'procreate.com', 'Sketch': 'sketch.com', 'Webflow': 'webflow.com',
  'Wix': 'wix.com', 'VSCO': 'vsco.co', 'Snapseed': null, 'Affinity': ['affinity.studio', 'affinity.serif.com'], 'Blender': 'blender.org', 'GIMP': 'gimp.org',
  // Video
  'YouTube': 'youtube.com', 'Adobe Premiere Pro': null, 'DaVinci Resolve': 'blackmagicdesign.com', 'Final Cut Pro': null,
  'iMovie': null, 'InShot': 'inshot.com', 'OBS Studio': 'obsproject.com',
  // Music
  'Spotify': 'spotify.com', 'Shazam': 'shazam.com', 'GarageBand': null,
  // Social
  'Reddit': 'reddit.com', 'Pinterest': 'pinterest.com', 'Mastodon': 'mastodon.social', 'BeReal': ['bereal.com', 'bere.al'],
  // Shopping
  'Shopify': 'shopify.com',
  // Maps and rides
  'Apple Maps': 'maps.apple.com', 'Waze': 'waze.com', 'Uber': 'uber.com', 'Lyft': 'lyft.com', 'Grab': 'grab.com',
  'DiDi': 'didiglobal.com', 'Ola': 'olacabs.com', 'Gojek': 'gojek.com', 'Lime': 'li.me',
  // Food
  'Zomato': 'zomato.com',
  // Health
  'Apple Health': null, 'Health Connect': null, 'Strava': 'strava.com', 'Fitbit': 'fitbit.com', 'Garmin Connect': 'connect.garmin.com',
  'Oura': 'ouraring.com', 'WHOOP': 'whoop.com', 'MyFitnessPal': 'myfitnesspal.com', 'Samsung Health': null, 'Withings': 'withings.com',
  'Peloton': 'onepeloton.com', 'Nike Run Club': null, 'Headspace': 'headspace.com', 'Calm': 'calm.com', 'Flo': 'flo.health',
  'Clue': 'helloclue.com', 'Zwift': 'zwift.com',
  // Reading and news
  'Apple News': null,
  // Business
  'HubSpot': 'hubspot.com', 'Microsoft Dynamics 365': 'dynamics.com', 'Close': 'close.com', 'Freshsales': 'freshworks.com',
  'Odoo': 'odoo.com', 'SAP': 'sap.com', 'NetSuite': 'netsuite.com', 'Typeform': 'typeform.com', 'Jotform': 'jotform.com',
  // Support
  'Zendesk': 'zendesk.com', 'Freshdesk': 'freshdesk.com', 'Gorgias': 'gorgias.com', 'Kustomer': 'kustomer.com',
  // Automation
  'Zapier': 'zapier.com', 'Make': 'make.com', 'IFTTT': 'ifttt.com', 'n8n': 'n8n.io', 'Apple Shortcuts': null, 'Tasker': null,
  'Airtable Automations': 'airtable.com',
  // Data
  'Airtable': 'airtable.com', 'Tableau': 'tableau.com', 'Snowflake': 'snowflake.com', 'BigQuery': 'console.cloud.google.com',
  'Databricks': 'databricks.com', 'MongoDB Atlas': 'mongodb.com', 'PostgreSQL': 'postgresql.org', 'MySQL': 'mysql.com',
  'Metabase': 'metabase.com', 'Amplitude': 'amplitude.com', 'Segment': 'segment.com',
  // Cloud
  'Amazon Web Services': 'console.aws.amazon.com', 'Google Cloud': 'console.cloud.google.com', 'Microsoft Azure': 'portal.azure.com',
  'Cloudflare': 'cloudflare.com', 'DigitalOcean': 'digitalocean.com', 'Heroku': 'heroku.com', 'Render': 'render.com',
  'Fly.io': 'fly.io', 'Linode': 'linode.com', 'Hetzner': 'hetzner.com', 'Oracle Cloud': 'cloud.oracle.com',
  // Monitoring
  'Sentry': 'sentry.io', 'Datadog': 'datadoghq.com', 'Grafana': 'grafana.com', 'New Relic': 'newrelic.com',
  'PagerDuty': 'pagerduty.com', 'Better Stack': 'betterstack.com', 'UptimeRobot': 'uptimerobot.com', 'Splunk': 'splunk.com',
  'Prometheus': 'prometheus.io', 'Opsgenie': 'atlassian.com',
  // Security
  'Have I Been Pwned': 'haveibeenpwned.com', 'VirusTotal': 'virustotal.com', 'Okta': 'okta.com',
  'Cloudflare Zero Trust': 'one.dash.cloudflare.com', 'Snyk': 'snyk.io',
  // Legal
  'DocuSign': 'docusign.com', 'Adobe Acrobat Sign': 'acrobat.adobe.com', 'Dropbox Sign': 'sign.dropbox.com', 'PandaDoc': 'pandadoc.com',
  'Ironclad': 'ironcladapp.com', 'Clio': 'clio.com', 'LegalZoom': 'legalzoom.com', 'Juro': 'juro.com',
  // People and HR
  'Workday': 'myworkday.com', 'BambooHR': 'bamboohr.com', 'Gusto': 'gusto.com', 'Rippling': 'rippling.com', 'Deel': 'deel.com',
  'ADP': 'adp.com', 'Personio': 'personio.com', 'HiBob': 'hibob.com', 'Remote': 'remote.com', 'Greenhouse': 'greenhouse.io',
  'Lever': 'lever.co', 'Workable': 'workable.com', 'Lattice': 'lattice.com',
  // Testing
  'BrowserStack': 'browserstack.com', 'Sauce Labs': 'saucelabs.com', 'LambdaTest': 'lambdatest.com', 'Cypress Cloud': 'cypress.io',
  'TestRail': 'testrail.com', 'Checkly': 'checklyhq.com', 'Percy': 'percy.io',
  // Games
  'Steam': ['steampowered.com', 'steamcommunity.com'], 'Xbox': 'xbox.com', 'PlayStation': 'playstation.com', 'Nintendo': 'nintendo.com',
  'Roblox': 'roblox.com', 'Epic Games': 'epicgames.com', 'Minecraft': 'minecraft.net', 'Chess.com': 'chess.com',
  'Lichess': 'lichess.org', 'Battle.net': 'battle.net', 'EA app': 'ea.com', 'Riot Games': 'riotgames.com',
};
