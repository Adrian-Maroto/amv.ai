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

## Silence is not approval

An approval that expires is a denial. An approval nobody answered is a denial.
The agent may re-ask later; it may not treat the absence of an answer as one.

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
