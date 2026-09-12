# Autonomy, risk, and what the agent may do without asking

Two independent scales. Autonomy is how far the user has let the agent go.
Risk is how much damage the action could do. An action runs only when the
autonomy level reaches the risk class - and some risk classes are never
reachable by any autonomy level.

---

## Autonomy levels

| Level | Name | The agent may |
|---|---|---|
| 0 | Off | nothing - no monitoring, no reading |
| 1 | Observe | read permitted data, record signals, say nothing |
| 2 | Notify | tell you what happened |
| 3 | Recommend | explain the options and suggest one |
| 4 | Prepare | create a draft, proposal or task - never send or submit |
| 5 | Ask and act | present the exact action and execute only after approval |
| 6 | Bounded autonomy | act inside a rule you wrote, with a budget, an allowlist, a time window and a risk ceiling |

There is no level 7. Unrestricted autonomy is not a product decision that is
available to make.

## Risk classes

| Class | Covers | Reversible |
|---|---|---|
| R0 | read, organise, categorise, summarise | n/a |
| R1 | reversible private action - draft, label, task, note | yes |
| R2 | external communication or scheduling - send, invite, cancel a meeting | usually not |
| R3 | purchase, booking, cancellation, meaningful account change | sometimes |
| R4 | money movement, trading, legal, medical, employment, identity, government submission | rarely |
| R5 | prohibited by law, policy, consent or platform rules | never runs |

## What runs without asking

| Risk | Default |
|---|---|
| R0 | automatic, with read permission |
| R1 | automatic only when reversible AND explicitly enabled |
| R2 | approval, or a narrow allowlist rule the user wrote |
| R3 | approval for that specific transaction |
| R4 | strong authentication, explicit approval, and often a licensed professional |
| R5 | never - no autonomy level, rule or approval reaches it |

**R4 is defined so it can be refused.** No connector or tool capable of moving
money, trading, filing tax or signing a contract is being added. Naming the
class is how the engine denies it, not how it enables it.

## Where these rules are actually enforced

This document describes what the POLICY ENGINE guarantees. Being precise about
what consults it matters more than the guarantees themselves, because a rule
enforced in a module that one path uses is a rule that one path has.

| | |
|---|---|
| Consults `amvPolicyEvaluate` | `_runDueAuto` / `runDueAutomations` - the scheduled runner. The only place AMV decides anything with nobody present. |
| Does not, deliberately | every attended surface. A person looking at the screen is the authority; asking an engine whether they may click is ceremony. |
| Enforced elsewhere, by construction | an unattended run can only ever email THE ACCOUNT OWNER - `_autoEmailResult` takes the address from the account, not from the job. It is not possible for a scheduled job to send to a third party, whatever its settings say. |

Two things follow. Autonomy CANNOT currently reach a stranger, which is why the
Auto agents in the brief stop at "prepare and ask". And the engine's guarantees
become the product's guarantees only for paths that consult it - so when a new
unattended path is added, routing it is not optional polish.

## The rule that keeps this honest

**Autonomy is never learned.** Approving the same thing twenty times does not
grant the agent permission to do it the twenty-first time by itself. The brief
says this and so does AMV's memory system: a repeated behaviour is *possible
evidence* of a preference, never a confirmed one.

Widening autonomy is always an explicit act by the user, creating a rule with
its own budget, allowlist and expiry. The agent may *offer* to create that rule.
It may not create one for itself.

## What a budget means

A rule can carry `max_runs`, and the policy engine refuses once `runs_used`
reaches it. The engine deliberately does not know what period that number
covers - a budget is a number, and the period belongs to whoever is counting.

Two periods exist today, and they are different promises:

| The user said | The period | Refills |
|---|---|---|
| "the first run only" | the job's whole life | never |
| "at most N runs a day" | the user's local calendar day | at their midnight |

"The user's local day" is deliberate: a UTC period hands somebody in Madrid
their budget back at two in the morning and takes a day off somebody in
Auckland every day. The period key is the local date string, so a device that
was asleep for a week resets once rather than trying to replay six days it
missed.

A budget is spent when the run STARTS, not when it succeeds. Otherwise a job
that fails every time keeps earning fresh automatic attempts, which is the
opposite of a bound. And a bound that cannot be read - a corrupted record, a
value from before the field existed - falls back to one run, never to
unlimited: a typo may cost somebody an automatic run, it may not grant them
unbounded automatic action.

Budgets compose with every other bound as AND. An unspent budget does not
outlive an expiry date, an unexpired date does not refill a spent budget, and
the autonomy pause outranks both.

## Quiet hours

Two integers and a timezone: from an hour, to an hour, in the zone the browser
reports. `23` to `7` is the ordinary case and the one a naive range check gets
wrong by covering nothing at all - the start is inclusive, the end exclusive,
and the window may cross midnight.

The zone is stored WITH the window and the hour is read in it. Storing the
window in UTC looks right and drifts by an hour twice a year, so somebody's
quiet hours would silently move when the clocks did.

**A job that comes due inside the window is HELD, not skipped.** Nothing runs,
nothing is spent, and `next` moves to the far side of the window rather than
staying in the past - otherwise every held job in the account fires at the same
second the window closes. The record carries `heldUntil`, and the row says
"Held until your quiet hours end" so a `next` time that moved does not read as
a broken schedule. It is deliberately not written into `lastError`, which the
row prefixes with "Last run:" - a held job did not have a run.

**Enforced in both places an unattended run can begin.** The cron holds the
jobs the account runs on the server; the browser tick holds the ones that only
exist in a device's storage. A suite runs both implementations over one table
and compares them case by case, because two enforcers of one promise drift the
moment somebody edits whichever file they had open.

**Quiet hours FAIL OPEN.** An unreadable window - a zone no machine can
resolve, an hour outside 0-23, a window that starts and ends at the same hour -
does not silence anything. That is the opposite direction from the approval
deadline below, which refuses when it cannot read the age, and the principle is
the same both times: fall towards the mistake somebody can see. A job that
stops running and says nothing is much harder to notice than one email at an
awkward hour.

They are a scheduling bound, not a permission one: they decide WHEN the tick
looks at a job, before any rule is read. That is why they are not routed
through the policy engine's `in_quiet_hours` branch - one promise with two
enforcement points is how bounds drift.

## The never list

A short list of addresses and domains AMV must never approach. Three shapes a
person would actually type: a whole address, `@domain`, or a bare domain (and
`*@domain`, which means the same as the second and was the one the first
implementation got wrong - `*` is a legal local-part character, so it validated
as a literal address and became a rule that could never match anything).

A domain entry covers its subdomains, because a receipt arrives from
`mail.bank.com` far more often than from `bank.com`, and somebody who wrote
"never @bank.com" did not mean "except that one".

**A refusal list, not an allowlist, and that is the whole design.** The policy
engine has understood `allowed_destinations` since it was written and nothing
ever passed one: an allowlist of everybody AMV may contact is a list nobody can
finish. People do not think "here are the eleven addresses you may write to";
they think "never my employer, never that bank" - a short list of the places
where being wrong is expensive.

**What it binds to, exactly.** AMV cannot send to a third party at all -
`_autoEmailResult` takes the address from the ACCOUNT and `AUTO_USES_ALLOWED`
holds no send - so this is not a send filter, because there are no sends to
filter. It governs what AMV **proposes**: the cancellation letters it writes
with the address filled in and a button that opens somebody's mail app. That is
worth governing on its own, because those addresses are read out of MAIL, which
makes the destination of a draft the one field in this product an outsider has
any influence over.

A refused destination gets no letter written - not a letter with a warning
attached - and the run says the refusal is why, so a subscription AMV found is
still reported. Refusing to write is not refusing to tell them.

**The entries are never audited by name.** The count is. This list is somebody
naming the people and institutions that matter most to them, and an audit log
is the last place that belongs.

An entry AMV cannot read refuses the WHOLE save and names the line, rather than
keeping the half it understood. A bound whose meaning is a guess is not a bound,
and the person would discover it was a guess at the worst possible moment.

## The rule you already wrote

Somebody who has approved the same job's result every morning for a week has
answered that question. Asking an eighth time is not caution - it is a tax on
having set the job up - and the person is the only one who can turn their answer
into a rule.

So AMV counts, per job, how the answers have run, and offers once:

| what happened | what is offered |
|---|---|
| five approvals in a row | deliver this without asking from now on |
| three refusals in a row | pause it - it costs money to produce something you throw away |

**Both directions, and that is the design rather than a nicety.** An offer that
only ever points towards more autonomy is a growth nudge in the costume of
helpfulness, and would be worth more to AMV than to the person. The suite that
covers this fails if the pause direction disappears.

Four rules it follows:

- **A streak, not a total.** One "no" resets the count. Somebody who said no
  once has not said yes five times in a row, and that "no" was the most
  informative answer in the sequence.
- **Declined means never again.** The flag is set when the offer is shown and is
  never cleared. A prompt somebody declined and then sees again is not an offer.
- **It never offers what the account forbids.** Proposing autonomy under a
  ceiling of "ask first" would be offering something that cannot happen, and
  accepting it would have lied to them twice.
- **The answer is re-derived under the lock, not trusted from the request.**
  Otherwise "accept: make it autonomous" would be a way to raise a job's
  permissions by asking for it.

Both answers are buttons of the same size. A "yes" styled as the obvious choice
and a "no" styled as a link is a funnel with good manners.

## Silence is not approval

An approval that expires is a denial. An approval nobody answered is a denial.
The agent may re-ask later; it may not treat the absence of an answer as one.

**Enforced on both queues, which it was not.** The web-agent ticket has always
expired after ten minutes. The crew queue - the one holding finished work that
SENDS EMAIL when approved - had no expiry at all, so an item could sit for a
month and go out on a click carrying facts that were true when it was written.
The doctrine was in this file and the enforcement was in another; that is the
failure this codebase keeps finding in itself.

| | how long | what happens after |
|---|---|---|
| web-agent ticket | 10 minutes | refused; the agent stops and asks again |
| crew approval | 7 days | refused; the recurring job produces a fresh one |

Seven days is short enough that the world has not moved on and long enough that
a job running at 3am survives a weekend. **A bound that breaks the feature is
not a bound, it is a bug people work around.**

Three rules the crew queue follows:

- **The deadline is enforced by the server**, not by the screen that draws the
  countdown. The client is also the half a stale tab controls.
- **Expiry refuses, it does not delete.** The draft stays visible; silently
  binning somebody's work to enforce a deadline is worse than the deadline.
- **An item that cannot be dated is treated as expired**, not as fresh.
  Refusing costs one re-run; the other direction sends something of unknown age.

## What is deliberately not built

- autonomous money movement
- autonomous trading
- personalised buy/sell instructions
- tax returns, contracts, legal or immigration filings
- medical diagnosis or prescription changes
- impersonating the user
- employment, credit, insurance, housing or admissions decisions
- unrestricted browser control

The platform may still be genuinely useful on all of these: summarise, detect
the deadline, gather the documents, prepare the draft, monitor the status,
explain the source, list what is missing, and hand the decision to the person
whose decision it is.
