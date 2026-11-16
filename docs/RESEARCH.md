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
| Catalogue jobs, Tasks, services (`country-catalog.js`, `data/countries/*.json`) | Every service the country's Wikidata entries list, per kind | Chrome UX Report visits **from that country** (`r`), then the country's own before the world's (`x`), then Wikipedia sitelinks (`w`) | Wikidata; Chrome UX Report via zakird/crux-top-lists; `docs/COUNTRY-DATA.md` | `country-data` and `country-popular` workflows; `node scripts/country-reach.mjs` after any change |
| Sites blocked nationwide (`CC_BLOCKED`) | Services left out in China and Russia | n/a | The long-standing, widely documented national blocks | By hand |
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

## Gaps - not backed yet

| What | Today | What would back it |
|---|---|---|
| Country facts (`COUNTRY_FACTS`, src/worker/65-country-capabilities.js): the tax office, banks, job sites, shops per country that job titles name | Written from well-known facts, with a field left out rather than guessed; the runner is told to check rules against the official source | Being checked: `scripts/facts-check.mjs` (the `facts-check` workflow) looks every name up in Wikidata and the country's Chrome UX Report list, writing a source per name to `data/facts-sources.json` and what does not resolve to `docs/FACTS-CHECK.md` |
| Which apps are on Integrations at all | Chosen by hand as "the apps people actually use" | The measure now orders them; 47 of 518 are not measured (31 have no website of their own - SMS, iMessage, a file format, device-only apps; 16 are not in the worldwide list) |
| The order of the topics on Integrations (Email, Calendar, Messaging ...) | Written order | Order by the GWI reasons above, or by what people connect (server counts) once there are enough |
| Crew's job templates and Task wording (what each one says it does) | Written | Not a ranking question; checked by the catalogue suites for what they claim |
| Crew's categories cap | Removed with the old page (Nov 16): the first hundred are weighted where use is | The owner chose popularity order; the chips reach every part of life |
