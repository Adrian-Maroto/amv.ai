# Saved sign-ins for an agent's browser - design

Owner decision #46 (Oct 31): build it now. The recommendation was to wait for
an outside security review first; that review (#39) is still owed before this
is offered to the public, and this page is what it should review.

## What exists today, and why it is not enough

AMV's hosted browser keeps a person signed in to a website between runs by
sending the site's cookies back to **the person's own browser**, which seals
them with a key that never leaves that device (`web-live.js`,
`_webJarIn`/`_webJarOut` in `21-web-agent-secrets.js`). The server stores no
cookie. That is why it is safe, and why it needs the device: a run with no
device open has no sign-in.

Two things are missing for an agent to work while the person's devices are off:

1. **A sign-in the server can hold for an agent.**
2. **An agent's background job that can use the browser at all.** Background
   jobs (`15-run-context-and-execution.js`) do not drive the hosted browser
   today. A store of sign-ins with nothing that reads it would be a feature
   that does nothing, so the two ship together or not at all.

## The rules it keeps

| Rule | How |
|---|---|
| Opt-in, per agent, per site | An agent has `browser.keep` (off by default) and a list of sites (at most 10). A cookie for any other site is never stored. |
| Never banks or payments | Sites that move money (banks, brokerages, card and payment providers, crypto exchanges) are refused when added and when stored - matched against a fixed list plus the bank-link providers AMV already knows. |
| Sealed | One record per agent, `agentjar:<email>:<agentId>`, sealed with AES-GCM under `CONNECT_KEY` - the same seal connected-account tokens use, so a copy of the store alone is ciphertext. Never in a backup (`BACKUP_NEVER`), erased with the account and with the agent. |
| Expires on its own | Each saved sign-in expires 30 days after it was last refreshed by a run the person watched; the record carries the date and storage drops it (expiration TTL). |
| Revocable at once | Settings > Security lists every agent holding sign-ins, by site, with "Forget"; forgetting deletes the record. Deleting or pausing the agent stops its use. Signing out everywhere forgets them all. |
| Never seen by the model | The model reads pages as text; cookies are put into the browser by the Worker and taken out by the Worker. No cookie appears in a prompt, a log, an audit line or a result. |
| Unattended means read-only | An agent's background browser run may open pages and read them. It cannot submit a form, buy, send, or change anything: those steps stop and become an approval in Crew, exactly as a background job's consequential action does today. |
| Every use is on the record | Each background run that used saved sign-ins writes one activity line (agent, site, time) the person can see. |

## How sign-ins get there

Only from a run the person watched: when they run AMV's browser **as an
agent** (the agent picker on the live browser view), on a site in that agent's
list, and the agent keeps sign-ins, the cookies of that site are sealed into
the agent's record at the end of the run - as well as going back to the device
as today. AMV never asks for a password; the person signs in on the real site
in the live view, as now.

## What it needs to be switched on

- The `BROWSER` binding (AMV's hosted browser), off on production today.
- `CONNECT_KEY`, already required for connected accounts.
- The outside review (#39) before it is offered to the public.
