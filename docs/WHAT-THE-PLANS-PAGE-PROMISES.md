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

## Open, and needs an owner decision

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

### The advertised usage multipliers understate what is delivered

`PLANS[x].mult` says 5x / 20x / 50x against Free. `PLAN_LIMITS.monthTokens`
delivers 7.2x / 28x / 72x. Every tier over-delivers, so there is no exposure -
but the page is underselling by about 40%, and the two numbers should either
be reconciled or the multiplier should be computed from `PLAN_LIMITS` the way
the automation count now is. Changing an advertised number is a pricing call.

### Free's binding limit is monthly, and the copy says daily

Free is `dayTokens: 52,000` and `monthTokens: 325,000`. The month is what binds
- about 10,800 tokens a day averaged - so a free user who explores for a week is
locked out for three. The blurb says "Daily usage to explore everything". Not a
money problem; an expectation problem, and the kind that produces a bad first
week.
