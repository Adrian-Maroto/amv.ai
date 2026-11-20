# What every list is built from

The owner's standing rule (Nov 16): every section, in every country, for every
integration, is backed by research. This file is the register: for each list
AMV shows, what decides **what is in it** and **what order it is in**, the
source, its date, and how to refresh it. A list that is not backed yet is named
under *Gaps* rather than left looking backed.

When you add or reorder a list, add its row here in the same change. A list
whose order is "how somebody typed it" is a gap, and goes under *Gaps*.

## Crew

| List | What is in it | Order | Source | Refresh |
|---|---|---|---|---|
| Crew's jobs for a country (`_cjList`, crew-view.js) | The country's top ten, the jobs written for it, the everyday jobs, then the country catalogue's jobs | What people in the country switch on (server counts, `meta.ranked`) first; then `_cwPopScore` | See the next three rows | Counts are live; the rest by script |
| Base weight of a job (`CW_GWI`, 10a-job-needs.js) | Every job, filed under the reason it serves | GWI share of internet users per reason | GWI, Q4 2025, via Statista, "main reasons for using the internet worldwide" | By hand, when GWI publishes |
| Country boosts (`CW_POP_BOOST`, `CW_POP_STRENGTH`) | Jobs that matter more somewhere | Scaled by the source's figure per country | World Bank remittances 2024; Global Findex 2025 (mobile money); PwC IAS 29 list, June 2026; rail km per person 2023; OICA vehicles per 1,000; national university-entry exams; World Gold Council 2024; OECD price-to-income 2024; ILO 2023 (farm jobs) | By hand; each figure is cited beside it |
| Catalogue jobs, Tasks, services (`country-catalog.js`, `data/countries/*.json`) | Every service the country's Wikidata entries list, per kind | Chrome UX Report visits **from that country** (`r`), then the country's own before the world's (`x`), then Wikipedia sitelinks (`w`) | Wikidata; Chrome UX Report via zakird/crux-top-lists; `docs/COUNTRY-DATA.md` | `country-data` and `country-popular` workflows; `node scripts/country-reach.mjs` after any change. **Since Nov 20 (Build 16 audit AG-12):** a service's rank is only ever its own host's or registrable domain's - the old fallback that let two owners sharing a first label share a rank is gone - and a run with no countries named refreshes every country whose ranking is more than three months old (`STALE_MONTHS`); each file says its month in `popular` |
| Sites blocked nationwide (`CC_BLOCKED`) | Services left out in China and Russia | n/a | The long-standing, widely documented national blocks | By hand |
| Crew's Popular chip (`_cjPopular`, crew-view.js) | The country's first fifty jobs | The same order as All, without the person's switched-on jobs lifted first: what people there switch on (server counts), then the research rows above | As the first row | Live |
| Tasks' Popular chip (`TK_POPULAR_N`, integrations-view.js) | The country's first fifty tasks | The task list's own order: Chrome UX Report visits from that country, then the country's own before the world's | As the catalogue row | `node scripts/country-reach.mjs` |
| Crew's Inbox & calendar for a country (`_cjInboxCal`) | A digest and an alert job for each of the country's national mailboxes; its public holidays | Mailboxes by Chrome UX Report visits from that country (app-reach), then written order | `AMV_MAIL_CC` (Integrations' national mailboxes); app-reach.json | With app-reach |
| See all jobs (the directory) | Every catalogue service times its job templates, in every country | As each country's catalogue | As above | Counted, never stored |

## Integrations

| List | What is in it | Order | Source | Refresh |
|---|---|---|---|---|
| The apps in each topic (`AMV_APP_CATS`, 13c-app-catalog.js) | 518 apps in 32 topics | Connected, then what connects, then what opens in AMV's browser, then Request; **inside each, Chrome UX Report visits from the visitor's country, then worldwide, then written order** | Chrome UX Report rank buckets, per country and worldwide, via zakird/crux-top-lists (Ruth et al., IMC 2022); October 2026 lists; each app's own website (`scripts/app-sites.mjs`) | `node scripts/app-reach.mjs` (about 900MB downloaded; set `CRUX_CACHE` to keep the lists) |
| A visitor's own mailboxes (Email) | The national mailboxes | By the same measure; before it arrives, right after Gmail and Outlook | The server's `MAIL_PROVIDERS` country per mailbox | With the mail list |

What the Chrome UX Report measures, said plainly: visits in Chrome to the
app's website. An app used mostly on phones is undercounted against one used in
a browser. Across apps that do the same job - the only comparison the page
makes, inside one topic - it is a fair measure. The report lists only sites the
public can reach, so an app's signed-in address often is not in it and its own
site is measured; a domain shared by a company's many products (google.com,
microsoft.com, adobe.com) is never credited to one of them.

## Chat home

| List | What is in it | Order | Source | Refresh |
|---|---|---|---|---|
| Suggestions under the box (`_homeSuggestHTML`, 05-ui-blocks.js) | Two, from two different places: one of the person's recent chats (carry on, what is new since, a weekly briefing - the last two only for an English title that reads as a subject; titles that are not words never shown), a Crew job, something to build | Which two places, and which chat: random, new on every load and new chat - the owner's instruction (Nov 17). **Which Crew job: weighted by the share of internet users who go online for that reason** | The person's own chats; GWI Q4 2025 main reasons for using the internet (`CW_GWI`, the Crew row above) | Live; GWI by hand |
| Starter chips (no recent chats) | Advice, Look up, Edit, Build, Automate | How people use an assistant, most first | NBER w34255 (2025), 1.5 million conversations | By hand |

## Gaps - not backed yet

| What | Today | What would back it |
|---|---|---|
| Country facts (`COUNTRY_FACTS`, src/worker/65-country-capabilities.js): the tax office, banks, job sites, shops per country that job titles name | **Backed for 3,006 of 3,262 names (92%, Nov 17)**, a source per name in `data/facts-sources.json`: entries of the country's own catalogue (Wikidata), Wikidata entries placed in the country (country, origin, jurisdiction, or through their owner), an official website people in the country visit (Chrome UX Report), or **cited by hand** (492): 88 from Wikidata's candidates for the name, read one by one, keeping only the entry plainly that thing in that country (given names, songs, papers and same-named things elsewhere rejected); 404 by the service's own website (`data/facts-sites.json`, written by hand, leaving out shared government domains and sections of larger sites), each kept only because the site is in that country's Chrome UX Report list - 14 addresses were not, and those names stay open. 120 are descriptions, not names ("your state DMV"). **136 real names remain** - most are a way of paying or an inspection rather than a service with an address ("transfers by CBU or CVU", "STK inspection"), or a service inside a larger site (Yandex Eda, MTN MoMo), which an address cannot prove (`docs/FACTS-CHECK.md`) | The 136 cited by hand; `scripts/facts-check.mjs` (the `facts-check` workflow, `--wider`, `--report`), `scripts/facts-candidates.mjs`, `scripts/facts-cite-sites.mjs` |
| Which apps are on Integrations at all | Chosen by hand as "the apps people actually use" | The measure now orders them; 47 of 518 are not measured (31 have no website of their own - SMS, iMessage, a file format, device-only apps; 16 are not in the worldwide list) |
| The order of the topics on Integrations (Email, Calendar, Messaging ...) | Written order. **Tried and rejected (Nov 17): the Chrome UX Report cannot order topics.** It measures sites, and a topic's score from it is a count of the apps somebody chose to list in it - Shopping came first because 16 of its 19 listed shops are in the top thousand; nearly every topic has one top-thousand app, so its best app ties them all | GWI's full "main reasons for using the internet" table (share of users per reason - staying in touch, video, music, shopping ... - not just the seven Crew uses), mapped one topic to one reason, with work topics (developer, cloud, monitoring) ordered by a work-software source; or what people connect (server counts) once there are enough. The table is on datareportal.com and statista.com, which this build environment cannot reach |
| Crew's job templates and Task wording (what each one says it does) | Written | Not a ranking question; checked by the catalogue suites for what they claim |
| Whether a country's Crew job can really be done for that service (Build 16 audit AG-12) | A country job is a research instruction AMV carries out in its browser; it is not a tested connection to that service, and nothing on screen says it is | A capability record per service - a working connector, its scopes, the countries it works in, when it last passed a test - before any listing may say it connects |
| Which other companies' models the picker offers, and in what order (`docs/PLAN-MODEL-PICKER.md`; built Nov 18) | AMV's own engines first, then each maker in the order the owner lists them in `AMV_PARTNER_ENGINES`; none switched on yet | The shape is backed (Perplexity's help center model table, snapshot Oct 27 2026). Which models, on which plan, in what order waits on the owner's contracts; the order then follows a public usage measure per model (to be chosen with the line-up), never a guess |
| Crew's categories cap | Removed with the old page (Nov 16): the first hundred are weighted where use is | The owner chose popularity order; the chips reach every part of life |
