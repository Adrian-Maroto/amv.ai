# Owner decisions

On 2026-10-19 the owner delegated the open decisions: "for the ones I have to
decide, do it based on your recommendation, to become big and billions."
Each one below was decided by that rule: reason from the failure that ends the
company, count the blast radius in people, prefer what can be verified, and
take the comfortable middle off the table when it is the trap.

What still needs the owner's own hand is only what the repository cannot do:
paying for something, or signing up for an account in the owner's name. Those
are listed at the end, with exactly what to do.

## Decided

**1. SCIM provisioning, Users only - YES, build it.**
The failure that ends an enterprise business is an ex-employee who still has
the company's chats and files, and at scale that is not rare: it is every
company forgetting somebody every week. SCIM makes the company's own directory
remove them within minutes, and it is the first thing a security review asks.
Scope as in DECISION-ENTERPRISE-IDENTITY.md: `/scim/v2/Users`, a per-team token
shown once and stored only as a hash, deactivation that ends every session and
removes the person from the team, every call in the team's audit log,
rate-limited. Groups wait for roles.

**2. SAML - OFF the table** until a paying customer names it as a requirement.
Company sign-in over OpenID Connect already reaches Okta, Entra ID and Google
Workspace. SAML's XML signature checking is the classic source of sign-in
bypasses, and doing it safely needs a dependency this codebase does not carry.

**3. New team roles - NOT YET.** Each role is a permission rule that must be
right on every route forever. The first one is added when a customer asks for
it (most likely "billing manager").

**4. Holding sign-ins on AMV's servers so a background run can use them while
the person's device is off - NO, and not "per site, opted in" either.**
That middle option is the trap. A store of live sessions to people's banks,
mail and shops is the single most valuable thing an attacker could take from
AMV, and an opt-in does not shrink it: it fills it with exactly the sites
people care most about. One breach would end the company, and LESSONS 537
already refused the password version of the same vault. What ships instead:
- the sign-ins stay sealed on the person's device, as now;
- the person can TAKE OVER the hosted browser to sign in or solve a check
  themselves (next on the browser roadmap);
- a background job that needs a signed-in site says so and waits for the
  device, rather than failing quietly.
Revisit only with hardware-backed per-user keys the server cannot use alone.

**5. Speech-to-speech voice - NOT THIS CYCLE.** Voice works today: heard on
the server, spoken as it is written, stops when talked over. A realtime
speech model is a supplier contract, a second price per minute and a
WebSocket path through the Worker, for lower latency and tone of voice. Worth
it once voice is a measured share of use; the digest already reports usage.

**6. Unattended sending, buying or acting on accounts - stays OFF,
permanently.** Already decided (ROADMAP Milestone 6); restated so it is never
re-opened by accident. Every unattended run reads and writes text; a person
approves anything that leaves.

**7. A native JetBrains plugin - NO for now.** It is a second codebase on the
JVM and a Marketplace account, for a surface the External Tools file already
covers. Revisit when JetBrains users are a measured share.

**8. Fitbit and Oura - NO for now.** Live health data is a regulated,
high-liability category, and the Apple Health export (read on the device,
nothing kept) already serves the people who want it. Revisit with a privacy
review, not as an integration.

**9. Chrome Web Store - YES. Google Play (as an installed web app) - YES.
Apple App Store - LATER.** The Chrome extension holds no key and asks for
activeTab only, so review is routine and it removes the "Developer mode"
step that loses most people. Play can list the installed web app as it is.
The App Store needs a native shell and its own review cycle; it waits until
the web app's retention on iPhone is measured.

## What needs the owner's own hand

Only payments and accounts in the owner's name. Nothing here can be done from
the repository.

1. **Cloudflare Workers Paid ($5 a month)**, then tell AMV it is on. It turns
   on the hosted browser (Browser Rendering: $0.09 per browser hour after 10
   included). The binding stays commented out until then, because switching it
   on without the plan breaks every deploy.
2. **Chrome Web Store developer account** (a one-time $5 fee). Upload
   `amv-chrome.zip` from Settings > API keys.
3. **Google Play developer account** (a one-time $25 fee), for the installed
   web app.
4. **A speech supplier key**, when voice is worth the per-minute price -
   pasted into the deployment's settings; nothing else changes.
