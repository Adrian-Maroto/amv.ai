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
