# AMV / AMV.AI — Complete Project Context

> Paste this to Claude Code (or any assistant) to give full context on AMV.
> All facts below were verified against the live codebase. Line numbers are
> starting hints only — they drift as files are edited, so confirm with grep.

---

## 1. WHAT AMV IS

AMV (branded **AMV.AI**) is a **single-file-deployable AI-workforce web app** — a
ChatGPT/Claude-style product. It bundles: AI chat, image & video generation,
autonomous agents ("Crew" / "Handoff"), a build suite ("Studio" / "Dev" / "Lab"),
a creator marketplace, projects, memory, scheduled tasks, and a full plans/billing
system. It is sold as a product.

**The owner's goal is a high-profit exit, scaling toward a $60B valuation.** Every
decision is weighed against profitability and scale, not just features.

---

## 2. OWNER DIRECTIVES (NON-NEGOTIABLE)

- **Max quality, no fake / visual-only features.** Everything must actually work
  or degrade honestly. No placeholder features pretending to function.
- **Honest degradation without API keys.** The owner adds API keys at deploy time.
  Everything must work or degrade truthfully *now*, before keys exist. (This is
  why, e.g., UI translation ships a built-in dictionary rather than relying on an
  AI call that needs a key.)
- **Never mention Claude / Anthropic in user-facing output.** Brand everything as
  AMV. (Internally the backend calls Anthropic models; users never see that.)
- **Verify every change.** Reproduce the actual bug before claiming a fix, and
  confirm the fix live (via Playwright DOM checks / tests) — not "it should work."
- **Go in order, one item at a time.** Each fix tested + shipped; nothing
  half-built left in the deliverables.
- **Profit-first framing** on any business-model decision (usage limits, pricing,
  margins).
- **Owner email:** `amarotovaleria@gmail.com` (hardcoded in app.js ~1209;
  overridable via `window.__AMV_OWNER_EMAIL__`).

---

## 3. BUSINESS MODEL / MONEY

### Plans (monthly)
Free · Pro **$15** · Elite **$75** · Ultra **$200** · Custom (owner-priced).

### Usage = own model tiers, NOT dollar passthrough
Users see **named model tiers** and a **Claude-style "% remaining on your plan"**
rolling window (5-hour window; `AMVUsage` in app.js ~1059) — **never a dollar
balance**. The plan *price* is fully decoupled from raw token cost.

**Model tiers** (`MODELS` object, app.js ~1226) — key → label → real backend model → cost weight:
| key | label | backend model | cost weight | min plan |
|-----|-------|---------------|-------------|----------|
| auto | AMV Auto | (auto-picks) | 0 | free |
| fast | AMV Pulse | claude-haiku-4-5 | 1 | free |
| core | AMV Core | claude-sonnet-4-6 | 2 | free |
| coding | AMV Forge | claude-opus-4-8 | 3 | pro |
| smart | AMV Apex | claude-fable-5 | 4 | elite |
| image | AMV Vision | image | 0 | (hidden) |

(When the owner swaps in their own models, map them into this `MODELS` object.)

### Margin-safe token allowances (verified, in sync client+backend)
Backend `LIMITS` (amv-backend.js ~148) and client `PLAN_TIERS` (app.js ~8704) —
**must stay in sync**:
| plan | day tokens | month tokens | rpm | images/day | videos/mo |
|------|-----------|--------------|-----|-----------|-----------|
| free | 40,000 | 250,000 | 8 | 8 | 0 |
| pro | 250,000 | 1,800,000 | 20 | 100 | 20 |
| elite | 900,000 | 7,000,000 | 40 | 500 | 120 |
| ultra | 2,200,000 | 18,000,000 | 80 | 2,000 | 600 |

Worst-case margins (blended ~$6/Mtok): **pro ~28% / elite ~44% / ultra ~46%**,
typically 80%+ since cheap models handle most calls. A hidden
`costCeiling = planPrice * 0.45` (amv-backend.js ~595) remains as an **invisible
anti-abuse backstop** normal users never hit. `tests/worker/plan-margins.test.mjs`
fails the build if allowances go loss-making.

### Marketplace
Users sell prompts / tools / crews. **Platform (owner) keeps 20%, seller gets 80%**
(`MARKET_PLATFORM_FEE = 0.20`, amv-backend.js ~4257; `_creditSale` credits seller
`price * (1 - fee)`). All payments flow into ONE unified ledger (Stripe subs +
renewals, PayPal, marketplace fees), deduplicated. Content moderation blocks illegal
listings (drugs incl. cannabis/slang, weapons, malware, fraud, stolen data, CSAM,
violence, hate, piracy, self-harm) on **BOTH** client (`_mktScreen`) and server
(`_marketScreen`, can't be bypassed), with a **3-strike seller suspension**.

### No ads. Revenue = subscriptions + 20% marketplace fees.

---

## 4. ARCHITECTURE (single-file-deployable)

- **Frontend build:** `app.js` (~1.12MB — the SINGLE SOURCE OF TRUTH; the build
  reads ONLY this) + `styles.css` (~410KB) → `node build.mjs` bundles them into
  `index.html` (~1.57MB). `i18n-dict.js` (~48KB) is a 144-term × 17-language
  translation dictionary; its content is inlined + merged into the runtime `I18N`
  object in app.js.
  - ⚠️ Old numbered module files (`00-core-state.js`, `10-chat-engine.js`, …,
    `70-agents-lab.js`) from an earlier code split are **INERT** — NOT referenced by
    any build tooling. Do not mistake them for source. `app.js` is authoritative.
- **Backend:** `amv-backend.js` (~262KB) — a **Cloudflare Worker**. Storage via
  Cloudflare **KV / D1**. Auth: PBKDF2-SHA256 password hashing + signed **JWTs**.
- **Deploy:** create a KV namespace → paste its id into `wrangler.toml` (currently
  the placeholder `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` on line 14) → `npx wrangler
  deploy`. Fully documented in `DEPLOY.md`.

### Secrets (owner sets at deploy — see DEPLOY.md)
Required: `ANTHROPIC_API_KEY`, `JWT_SECRET`.
Also: `ADMIN_TOKEN`, `EMAIL_API_KEY`, `GLOBAL_DAILY_USD_CAP` (default $500),
Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`),
PayPal (`PAYPAL_CLIENT_ID`/`SECRET`/`MODE`, `PAYPAL_PLAN_*`),
Twilio, Google (`GOOGLE_CLIENT_ID`), `ALERT_WEBHOOK`,
`TURNSTILE_SECRET` (+ client `window.__AMV_TURNSTILE_SITE_KEY__`).

---

## 5. SECURITY MODEL (solid — do not weaken)

- **Server is the absolute source of truth.** Identity comes from a
  cryptographically-signed **JWT** (verified with `JWT_SECRET` in `requireUser` /
  `verifyToken`, amv-backend.js ~2259). The plan is read from the server's own
  entitlement store (`DB.get(env,'ent',email)`), **NEVER** from client input. A user
  editing `localStorage.amv_plan` in the console **cannot** steal real usage or
  premium models — the server returns 402/403. Proven by
  `tests/worker/plan-security.test.mjs`.
- Client `verifiedPlan()` (app.js ~8438) keeps the UI honest (won't show fake-unlocked
  state) but is NOT the security boundary — the server is.
- Premium engines gated server-side: `PLAN_RANK[user.plan] < PLAN_RANK[eng.minPlan]`
  → 402.
- **Admin gating:** client `isAdmin() → isOwnerMode() → _isOwnerEmail(S.user.email)`
  (needs `OWNER_EMAIL`); server `_requireAdmin(request,env)` checks Bearer token ==
  `env.ADMIN_TOKEN` (constant-time), some endpoints also owner-email-gate via
  `env.OWNER_EMAIL`.
- **CAPTCHA/bot protection:** honeypot fields (always on) + Cloudflare Turnstile
  (`_verifyCaptcha` fails closed when `TURNSTILE_SECRET` set; only renders the widget
  when the client site key is set).
- **Account deletion** (`/auth/delete` → `authDeleteAccount`) purges ~15 per-user KV
  prefixes but KEEPS `tokepoch` (token-revocation marker); only deletes self. Data
  export exists.
- **Error alerting:** throttled `alertOnce()` layer over `notify()`; loud on model
  401/403, 5xx, Stripe checkout failures, and the global daily USD cap.

---

## 6. BUILD / TEST WORKFLOW (follow this)

- `node build.mjs` → assembles index.html from app.js + styles.css.
- `npm test` → build + `tests/run.mjs` (auto-discovers `*.test.mjs` in
  `tests/e2e/` + `tests/worker/`).
- `npm run check` (check.mjs) → **full gauntlet**: (1) syntax both files → (2) Worker
  module-load check via `import()` → (3) fresh build → (4) all suites → (5) preflight.
  Placeholder KV id = warning, not failure.
- Other scripts: `npm run preflight` / `predeploy`, `npm run backup` / `restore`,
  `npm run deploy`, `npm run test:e2e` / `test:worker` / `test:security`.

**Current state: ✓ SHIPPABLE. 29 test suites green (19 worker + 10 e2e, 700+
assertions).**

Worker suites: abuse, account-delete, admin-users, alerting, auth, backup, captcha,
check, crew-handoff, finance, market-moderation, metering, plan-margins,
plan-security, preflight, ratelimit, reset, video, worker.
E2e suites: agentic, auth-client, errors, forgot, mobile, regressions, research,
security, smoke, video.

### After EVERY edit
1. `node --check` both files.
2. Module-check the Worker: `node -e "import('./amv-backend.js').catch(e=>{if(e instanceof SyntaxError)process.exit(1)})"`.
3. `node build.mjs`.
4. Run the suite.
5. `cp` deliverables to `/mnt/user-data/outputs/` (app.js, amv-backend.js, styles.css,
   index.html, i18n-dict.js, DEPLOY.md, package.json, tests/**).

### Live testing
Playwright serving index.html over a local http server, then in the page:
`goApp()`, set `S.user = {name,email,ini}`,
`localStorage.setItem('amv_cookie_consent', JSON.stringify({essential:true}))`.
Cleanup lines that call app functions must run inside `page.evaluate()`, not Node scope.

---

## 7. RECURRING EDITING LESSONS (each caused a real bug — heed these)

- **`node --check` is NOT enough for the Worker** — always also module-check via
  `import()` (catches runtime module errors syntax-check misses).
- Inserting text before a function can accidentally delete the target's signature
  line — re-check after edits near function boundaries.
- Many `app.js` string literals use single-backslash unicode; `str_replace` often
  fails on them — fall back to a Python heredoc:
  `assert src.count(ANCHOR)==1` then `src.replace(x, y, 1)`.
- `getEntitlement(request,env)` is an HTTP handler, NOT a data getter — read
  entitlement via `DB.get(env,'ent',email)`.
- **Modals inside `#ovr` render OFF-SCREEN** unless `#ovr.on` gets the centering
  flexbox — the rule is keyed on `:has(> .share-modal / .rw-modal / .wn-modal)`. When
  adding a new modal class, add it to that rule (styles.css) or it falls to the bottom.
- **`closeOvr()` must remove `.on` AND clear innerHTML** — otherwise an invisible
  scrim stays over the page and traps all clicks (app appears frozen). It's shared by
  many modals.
- **CSS is a patchwork: ~24 stacked override layers + 1,200+ `!important`** — later
  layers win. Do NOT add a fighting layer mid-file; append ONE clean authoritative
  layer at the very end. The owner chose targeted polish over a full CSS consolidation
  — the big refactor is deferred.
- **i18n restore bug pattern:** the DOM-walk collector skipped text nodes with no
  Latin letters, so once text was translated (e.g. to Arabic) it couldn't be restored
  on switch-back. Fix: collect nodes that have Latin letters OR a stored `_i18nSrc`.
- **Test-ordering flakiness:** e2e tests after many assertions inherit dirty state
  (open modals, rate-limit counters). Prefer asserting on code paths
  (`fn.toString()` includes X) or definitive signals over fragile full-UI flows.
  Backend tests sharing a KV `store` Map must clear keys between sections.

---

## 8. PRODUCT SURFACE (tabs / features)

Chat · Images · Video · Crew (agents) · Handoff · Studio · Dev · Lab · Projects ·
Memory · Tasks · Marketplace · Plans · Help · Usage · Settings.
Settings panes: Account, Privacy, Security, Billing, Usage, Capabilities, Appearance,
Language, Skills, Connectors (id=`integrations`), Projects, About.
Owner-only admin dashboard: **Finance** tab (all payments, all methods, deduped) +
full **user directory** (every account: email, name, plan, payment source, monthly
AI cost, wallet balance, marketplace purchases, join date, abuse flags).
Also: light/dark themes, **19-language i18n** (Auto-detect + English + 17 translated:
Spanish, Chinese, Hindi, Arabic, Portuguese, French, German, Japanese, Russian,
Indonesian, Bengali, Urdu, Turkish, Vietnamese, Italian, Korean, Tamil) with **RTL**
for Arabic/Urdu, keyboard shortcuts, mobile bottom-nav + drawer sidebar, PWA install,
"What's New" changelog.

---

## 9. KEY FILE LOCATIONS (verbatim; confirm with grep — line #s drift)

### app.js
- `OWNER_EMAIL` ~1209; `isAdmin`/`isOwnerMode`/`_isOwnerEmail` ~1213
- `AMVUsage` (5hr rolling window) ~1059
- `MODELS` ~1226; `MODEL_ORDER` just after
- `PLAN_TIERS` ~8704; `verifiedPlan` / `syncEntitlement` ~8438
- `I18N` object ~3058; merged dictionary (`for(var k in __D)…`) ~3121; `T()` +
  `_translateUI` / `_collectI18nNodes` / `_restoreI18nDOM` ~3142; `LANGS` (19)
- Marketplace: `_mktSellerProfile` ~6983 (official-AMV branch has no email → routes
  to Help/support; real sellers → `_mktChat`), `_mktChat` ~7062, `_mktScreen` +
  `_MKT_PROHIBITED`/`_MKT_REGULATED`/`_MKT_RISK` ~7215–7276, `_mktSell` ~7340
- `openWhatsNew` + `CHANGELOG` ~12858/12885; `closeOvr` ~325 (removes `.on` + clears)
- `render404View` / `renderHelpView` ~11276/11472; `openTerms` / `openPrivacy`
  (separate, accurate — PBKDF2, Cloudflare KV/D1, no-sell/no-train)
- `goApp` ~2336; `_initMobileSidebar` (720px breakpoint) ~2383; `_renderBottomNav`

### amv-backend.js
- `LIMITS` table ~148; `PLAN_RANK` ~71; `PLAN_PRICE`
- `requireUser` / `verifyToken` ~2259; `effectiveLimits` ~2262
- `aiProxy` (reserve-then-reconcile metering; `usg:{email}:{day|month}`;
  `costCeiling = planPrice * 0.45` ~595)
- `_recordTxn` / `_readTxnLog` / `adminFinance`; `stripeWebhook`
  (checkout.session.completed + invoice.paid → ledger, deduped vs live Stripe pull)
- `_creditSale` (`MARKET_PLATFORM_FEE = 0.20`, seller gets 80%) ~4257
- `marketPublish` + `_marketScreen` (server-side moderation, 3-strike ban) ~4082
- `adminUsers` (owner-gated, full detail); `authDeleteAccount`; `_requireAdmin`
- top-level fetch handler serves a friendly 404 to browsers, JSON to API

### styles.css (last-winning layers appended at file end, in order)
`Admin user list: full detail` → `FINAL POLISH` → `RESPONSIVE FIT` →
`LIGHT-MODE MENU FIX` → `RESPONSIVE FIT v2`.
Design tokens: `--bg:#1a1b1f`; accent `#5590ff` (periwinkle blue); `--sbw:250px`
(narrowed to 212px on tablets 721–1000px); body **Inter**, display **Space Grotesk**,
mono **JetBrains Mono**. Sidebar `#sb` becomes a drawer + bottom-nav at
`max-width:720px`.

### KV prefixes per user (deletion keeps `tokepoch`)
acct, ent, entitleitem, data, auto, team, userteam, teamtasks, sites, site, abuse,
seller, widget, market, wallet, purchases, stripecust, tokepoch, sms.

---

## 10. RECENTLY COMPLETED WORK (all shipped + tested)

- **Launch blockers:** real separate Privacy Policy (accurate), throttled error
  alerting, account deletion + data export.
- **UI fixes batch:** Settings "Close" label, rail toolbar, sidebar footer, real 404
  page (client + server), copyright auto-year, CAPTCHA/honeypot+Turnstile, import-text
  monospace fix, login "no account" → routes to signup.
- **Money visibility:** admin Finance page, all-payment-methods unified ledger
  (Stripe subs+renewals+PayPal+marketplace, deduped), full owner user directory.
- **Business model:** usage → own model tiers, margin-safe allowances (the $-passthrough
  fix), margin regression test.
- **Latest six-issue batch (each root-caused, fixed, tested):**
  1. **Security** — server enforces real plan via signed JWT; console hacks can't
     steal usage/premium (5 tests).
  2. **Light-mode black menu** — account popup / context menus / toasts had a
     hardcoded dark bg with no light override; now theme-aware.
  3. **Language switching** — full 19-language translation with no API key, RTL, no
     text stuck in the old language on switch-back (4 tests).
  4. **What's New** — was rendering off-screen + trapping clicks; now centered +
     closes cleanly.
  5. **Marketplace** — "by AMV" now opens a proper profile with a working contact
     button; real sellers messageable; drug/illegal listings blocked client + server
     (16 moderation tests).
  6. **Responsive fit** — audited 320px→3440px, zero overflow; narrowed the tablet
     sidebar (212px) for more content room; ultrawide side-padding; landscape-phone
     trims (regression test covers 9 sizes).

---

## 11. CURRENT STATE

✓ **SHIPPABLE.** 29 test suites green. No known bugs, nothing half-built. Source and
`/mnt/user-data/outputs/` are in sync. The ONLY outstanding non-code item is the KV
namespace id placeholder in `wrangler.toml` (owner sets at deploy). Next steps when
ready: owner adds API keys + KV id and runs `npx wrangler deploy`; optionally map own
models into `MODELS`, tune allowances once real usage is seen, and (deferred) the big
CSS consolidation of the ~24 override layers.
