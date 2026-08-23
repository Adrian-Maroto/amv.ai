# What the plans page promises, and what enforces it

A feature list is a specification. Every line the plans page states as included
in a tier is a claim the server is making, and deserves what an authorization
rule gets: enforced in one place, server side, with a test that fails when it
stops being true.

This is the result of reading down the page and asking, for each line, **what
enforces this?** It is a live document - add a row when a claim is added.

## Closed

| Claim | Enforcement | State |
|---|---|---|
| Elite "One-click deploy to a live URL" | `deploySite` plan gate, `PLAN_RANK.elite` | **Fixed.** Had no plan check at all; any free account could publish and host 25 live sites. `smoke-real` + `worker.test` |
| Ultra "Deploy & host multiple live apps" | `maxSites` in `deploySite` (Elite 1, Ultra `SITE_MAX_PER_USER`) | **Fixed.** Same commit |
| Elite "Unlimited scheduled automations" | `AUTO_MAX_BY_PLAN.elite = 25` | **Fixed.** The claim was false; the page now prints the real number, read from a table pinned to the Worker's by `the-page-cannot-promise-what-the-server-refuses` |
| Pro "Autonomous agents and Crew" | `AUTO_MIN_PLAN = 'pro'` | Enforced |
| Elite / Ultra "Team workspaces - 10 / 25 seats" | `TEAM_SEATS` | Enforced |
| Pro "All models, including AMV Forge" / Elite "Apex first" | model gate, 402 `plan_required` | Enforced |
| Pro "Image, video, and 3D generation" | `PLAN_LIMITS.imagesDay` / `videosMonth` | Enforced |
| Free "Daily usage to explore everything" | `PLAN_LIMITS.free` | Enforced |

## Decided, and queued behind the design audit

All three were put to the owner with recommendations and costings on 2026-08-23,
and all three are APPROVED to build. The owner's steer was to decide them the way
a company aiming at enormous scale would, and the order is explicit: **the whole
design audit finished and green first, then these three, then further feedback.**

They are tracked as queue items #13, #14 and #15, each blocked by the design-audit
items, so nothing here starts early. The reasoning is kept below in full, because
the recommendation for #2 CHANGED under the scale lens and the change is the point.

The principles that decided them, worth applying to the next pricing question too:

- Trust compounds and so does churn, so revenue that costs credibility is
  negative expected value.
- Every advertised claim is a promise the server has to keep - one place,
  enforced server-side, with a test that fails when it stops being true.
- The free tier is the top of the funnel, not a cost line. One Pro conversion
  pays for four free users.
- Sell what the tier lets somebody DO, not a multiple of the free tier.

---

## The three, as decided

### Parallel agents are sold as a tier and are not one

The comparison table reads:

| | Free | Pro | Elite | Ultra |
|---|---|---|---|---|
| Parallel agents / long jobs | - | Limited | Up to 5 | Unlimited |

Nothing in the Worker caps how many agents run at once, at any tier. So Pro and
Elite both get what Ultra is sold as having, and **Ultra's headline
differentiator is free at every tier** - the same shape as the deploy hole,
pointing the other way.

It is not a spend hole: every agent's model calls go through the atomic usage
counter, so a person running twenty at once still burns their own metered
allowance. What it costs is the reason to upgrade.

Two ways to close it, and this is a pricing decision rather than a defect fix,
so it is left open deliberately:

1. **Enforce it.** Cap concurrent agent runs per plan. This REMOVES capability
   from accounts that have it today, which needs explicit approval.
2. **Sell what is true.** Drop the row, or replace it with something the product
   does tier - queue priority, or the automation counts above.

Recommendation: (2), because (1) takes something away from paying customers to
make a table honest, and the table is the thing that is wrong.

**DECIDED: (2), and the replacement is already there.** `PLAN_LIMITS.rpm` is a
real per-plan throughput tier - 8 / 20 / 40 / 80 a minute - and it is enforced
atomically through the Durable Object. The row becomes that, read from the table
that enforces it. Queue item #13.

### The advertised usage multipliers understate what is delivered

`PLANS[x].mult` says 5x / 20x / 50x against Free. `PLAN_LIMITS.monthTokens`
delivers 7.2x / 28x / 72x. Every tier over-delivers, so there is no exposure -
but the page is underselling by about 40%, and the two numbers should either
be reconciled or the multiplier should be computed from `PLAN_LIMITS` the way
the automation count now is. Changing an advertised number is a pricing call.

**DECIDED, and the recommendation changed on the way.** The first answer was
"compute it and round down". Under the scale lens that is only half: **"x free"
is a weak axis.** It anchors the price on the free tier and invites comparison
shopping on quantity, which is a commodity race. So the multiplier becomes
computed and conservative (7x / 25x / 70x, rounded DOWN so there is headroom -
an advertised multiplier is a promise), AND it stops being the headline. The
blurb leads with what the tier lets somebody do. Queue item #14.

Not doing: lowering allowances to match the old copy. Margin is protected by the
dollar backstop, not by the token cap.

### Free's binding limit is monthly, and the copy says daily

Free is `dayTokens: 52,000` and `monthTokens: 325,000`. The month is what binds
- about 10,800 tokens a day averaged - so a free user who explores for a week is
locked out for three. The blurb says "Daily usage to explore everything". Not a
money problem; an expectation problem, and the kind that produces a bad first
week.

**DECIDED: reshape at constant cost.** Keep `monthTokens` at 325,000 exactly -
same spend, same margin - and front-load it:

| shape | first week | after | fastest burn-out |
|---|---|---|---|
| today | 52,000/day | 52,000/day | **6.2 days** |
| flat honest | 10,833/day | 10,833/day | 30 days, no aha moment |
| **chosen** | **25,000/day** | **~6,500/day, cap 20,000** | **14 days** |

A big first week AND it cannot die on day six, for nothing. Costed and rejected:
a full week at today's cap plus a steady tail is +90% tokens, $1.95 to $3.70 per
free user per month, which is real money at a hundred thousand of them.

Also in scope: show when the allowance refreshes, because a daily rhythm is a
retention mechanic, and make "daily" true in the blurb. Queue item #15.
