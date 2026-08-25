# What a user actually costs, and what the plans can afford

You asked me to work out what a free user costs. The free tier turned out to be
the least of it.

**Assumptions, stated so you can correct them.** Engine prices are the ones in
`ENGINES` (per million tokens: Haiku 1/5, Sonnet 3/15, Opus 5/25, Fable 10/50).
Image cost is `IMAGE_COST_USD`, default **$0.04**; video is `VIDEO_COST_USD`,
default **$0.50**. Both are defaults in the worker, not quotes from a provider -
if the real numbers differ, every figure below moves with them, and the video
one is the most likely to be low. Token allowances count **input plus output**
together: `reserve = estIn + estOut`, so a long conversation spends its cap on
re-reading itself. Text mixes assume 75% input / 25% output, which is typical
once a conversation has any history.

---

## The free tier is fine. Images are what cost.

| | |
|---|---|
| 325,000 tokens on Haiku | **$0.65** |
| the same tokens on Sonnet | **$1.95** |
| 8 images a day for a month | **$9.60** |

A free user who never touches images costs well under a pound. One who uses
their image allowance costs **fifteen times more than their text**, and the
image allowance is the only part of the free tier not governed by the carefully
reasoned token cap.

## The paid plans are the problem

This is the table that matters. "Worst" is a user consuming the allowance the
plan advertises, on the dearest engine that plan can reach.

| plan | price | worst-case cost | margin | break-even utilisation |
|---|---|---|---|---|
| Free | $0 | $11.55 | -$11.55 | any usage is cost |
| Pro | $15 | $153.40 | **-$138** | 9.8% |
| Elite | $75 | $842 | **-$767** | 8.9% |
| Ultra | $200 | $3,168 | **-$2,968** | 6.3% |

Read the last column as: *if the average subscriber uses more than about a
tenth of what you sold them, that plan loses money.*

And the single dominant term is images:

| plan | images/day | cost at full use | as a share of the price |
|---|---|---|---|
| Pro | 100 | $120 | **800%** |
| Elite | 500 | $600 | **800%** |
| Ultra | 2,000 | $2,400 | **1,200%** |

The token allowances look deliberately reasoned - there is a long comment above
them explaining the 20,000/day trade. The image and video allowances read as
though they were chosen for how they look on a pricing page.

## What actually protects you today

`GLOBAL_DAILY_USD_CAP`, default **$500/day**, with free accounts limited to 70%
of it. That is a real circuit breaker and it works: you cannot lose more than
about $15,000 in a month no matter what happens.

But notice what it means. It does not make the plans profitable - it makes them
**undeliverable**. Once there is real usage, either people hit the global cap
and read *"AMV is at capacity"* on a product they have paid for, or you raise
the cap and lose money on every plan. An allowance you cannot afford to honour
is the same class of problem as a feature that does not work.

## What I would change

1. **Re-cost images and video against the price.** Pro at 100/day is $120 of
   exposure on a $15 plan. Something like 10-15/day for Pro, 40 for Elite, 100
   for Ultra puts images at roughly 25% of revenue at full use instead of 800%.
2. **Or meter them separately.** Images and video are the natural credit pack:
   they are discrete, people understand paying per image, and it decouples the
   scary unbounded cost from the subscription.
3. **Set `GLOBAL_DAILY_USD_CAP` deliberately** before the first user, to a
   number you would accept losing in a bad week. It is currently a default.
4. **Do not raise the cap to fix a capacity message.** That message is the
   system telling you the allowances are wrong.

None of this is urgent in the sense of being on fire - there are no users yet.
It is urgent in the sense that it is far cheaper to fix a pricing page than to
change a price people are already paying.
