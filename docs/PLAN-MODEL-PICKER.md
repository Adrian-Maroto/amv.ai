# Other companies' models in the picker - research and decisions (Nov 17)

The owner, Nov 17: "we are gonna be like Perplexity where we include models
like GPT Sol, Gemini, Claude, Opus, Fable etc, so research how they do it."

**Status, Nov 18: approved by the owner and built** (see "What was built").
What is left is the owner's: the contracts, which models on which plan, the
keys - and the one line in CLAUDE.md that still says no other AI company is
ever named on screen, which the owner edits (AMV does not edit its own
standing instructions). AMV's code still names no company: the names come
only from the owner's settings. Until a supplier is set up, the picker shows
AMV's own engines only - nothing is offered that cannot answer.

## How Perplexity does it

Source: Perplexity's help center, "What advanced AI models are included in my
subscription", a model table it calls "a snapshot as of October 27, 2026",
read through a search index on Nov 17 (perplexity.ai itself is not reachable
from AMV's build machines, so the page was not opened directly). Third-party
guides were consulted and disagree with each other on the line-up; they are
not used for facts.

- **One automatic choice first.** "Best" picks a model per question. It is the
  default and the only choice on the free plan.
- **Then the real models, by their real names.** Pro shows a selector of other
  companies' models under the names their makers gave them (the snapshot lists
  GPT-6.1 Sol, Grok 4.7 and Nemotron 3.5 Super VL on Pro; GPT-6 Astra on Max).
  The selector can be changed per question or set as a default.
- **The most expensive models sit one plan higher** (Max), not behind a
  per-question price.
- **Thinking is a switch, not another model**: "more time to reason before
  answering", offered on the models that support it.
- **The line-up is promised as nothing**: the table "is not a commitment to
  keep any individual model available. The model selector ... is always the
  source of truth." Models come and go monthly.
- **Several at once** (Model Council, Feb 2026): one question to three models,
  answers side by side.

## What AMV already has

- `src/worker/02-partner-engines.js`: other companies' models, through any
  endpoint that speaks the shared chat-completions protocol. An engine is
  offered only when the supplier's own model list confirms it exists (checked
  every six hours), is billed at its own price through the same reservation
  and metering as every other turn, and carries a minimum plan. Team owners can
  already restrict which engines their people use.
- The picker adds them when the server lists them (`_loadPartnerEngines`).
- **They are deliberately shown under AMV names** ("the partner's model id
  never reaches a screen"), because of the owner directive "never mention any
  other AI company in user-facing output".
- One supplier endpoint only (`AMV_PARTNER_URL`), and it is not switched on in
  production.

## What I recommend

**1. Name the models - in the picker and on the "answered by" line only.**
Recommend YES. Perplexity's entire offer is that the names are real: a person
choosing "GPT-6.1 Sol" can check that is what answered. An AMV name over
somebody else's model is a claim AMV cannot let anyone verify, and at a
billion people somebody compares outputs and publishes it the first week -
"AMV Apex is secretly X" is a worse story than "AMV lets you pick X".
Everywhere else (copy, emails, docs, code) stays AMV-only, and AMV's own
Auto stays first and default. Off the table: a halfway version with vague
labels ("a top US model") - it has the legal exposure of naming and none of
the trust.
This changes the owner's standing directive, so only the owner can say yes.

**2. Contract each maker directly; do not route everything through one
aggregator.** An aggregator is one key and the fastest start, which is why it
looks like the safe middle - but every prompt from every person then passes
through a company AMV has no data agreement with, and its outage takes every
model down at once. At scale the trust and the margins are in direct
contracts with zero-retention terms. Engineering cost: the partner layer
becomes a list of suppliers instead of one (small change; the metering,
existence check and plan floor already exist). Off the table: consumer-app
scraping or personal accounts of any kind.
The contracts, their prices and their keys are the owner's.

**3. Plans: Auto for everyone; named models from Pro; the dearest models one
plan up** - Perplexity's shape, and the only one where a heavy user of the
most expensive model cannot cost more than their plan pays. Which models sit
on which plan is a price decision, so it is the owner's; the plan floor per
engine (`minPlan`) already enforces it on the server.

**4. Thinking as a switch** on engines whose supplier supports it
(`reasoning` is already a field on a partner engine). Mine to build once 1-3
are answered.

**5. Not now: several models at once.** It triples the cost of a question and
there is no evidence yet that people here want it. Revisit with usage data.

## What was built (Nov 18)

1. Up to four suppliers, each its own contract: `AMV_PARTNER_URL` /
   `AMV_PARTNER_KEY` and the same names ending `_2`, `_3`, `_4`; an engine in
   `AMV_PARTNER_ENGINES` names its `supplier`, and each supplier's own model
   list decides its engines. Example entry:
   `{"key":"amv-sol","model":"<the id the supplier's API takes>","supplier":2,
   "maker":"<company>","name":"<the maker's model name>","minPlan":"pro",
   "inCost":2.5,"outCost":10,"maxOut":16000,"reasoning":true,"vision":true}`.
2. `maker` and the maker's own model name on each engine, shown in the picker
   grouped by maker under AMV Auto; "answered by <model>" on each reply.
3. The Thinking switch where supported.
4. Suites: an engine the supplier no longer lists disappears from the picker
   and is refused by the server; a plan below the floor cannot reach it by
   request; the price per turn is the engine's own.

## What the owner provides

The supplier keys go into Cloudflare's secret settings (never into chat), one
per company contracted.
