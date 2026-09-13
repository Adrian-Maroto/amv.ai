# Crew games - the execution layer

A Crew job could already think and write. What it could not do was produce
something OTHER PEOPLE INTERACT WITH and read their answers back, so every
"Friday game night" idea died at distribution: nothing could receive.

This is the layer that closes the loop.

    agent makes a game -> a link -> people answer -> state is held ->
    the result is computed once -> the group is told

Once that exists, most of a template list is configuration rather than
engineering. Prediction night, group awards, photo challenges, "who is free",
weekly recaps and match-day agents are all the same five steps with different
prompts. None of them was buildable before, and none of them needs new plumbing
now.

## The routes

| Route | Who | What |
|---|---|---|
| `/v1/game/create` | owner | Makes a game, returns the id and `/g/<id>` |
| `/v1/game/join` | **anybody** | Nickname in, participant token out |
| `/v1/game/answer` | participant | One submission, idempotent |
| `/v1/game/state` | participant | What that person may see right now |
| `/v1/game/close` | owner | Stops the clock |
| `/v1/game/reveal` | owner | Scores once, opens the answers |
| `/v1/game/mine` | owner | Host view: who has answered |

## What joining without an account forces

The owner decided that people without accounts may join by link. That single
decision sets most of the design, and none of the following is optional.

**The link is the credential.** There is no password behind it, so the id is 24
characters of full entropy and each player gets their own token. Guessing one of
those is the entire attack surface.

**No account means no age on record**, and this product gates money on a
confirmed birth year. So a game may never touch money - checked at CREATION,
because a game that reaches a screen asking for a card has already done the harm
the age gate exists to prevent. `game_no_money` says so in one sentence.

**Answers are untrusted input that lands on other people's screens.** Control
characters are stripped by codepoint, length is bounded at 280, one submission
per player, and everything is escaped where it renders.

**There is no account to rate-limit by**, so joins and answers are limited per
IP hash.

**A participant record is personal data with nobody's account behind it.** It
lives inside the game record, so it dies with the game - and `gameown` is in
PER_USER_KINDS, so erasing the creator erases the people who played too. They
have no account of their own to keep it under.

**Nothing leaks before the reveal.** Not the answers, not the tally, not who
else joined. A game that shows the running score is a game everybody waits to
answer last. The host is the one exception and only for WHO has answered, since
the point of that screen is chasing the two people who have not.

**A wrong token is answered exactly like a wrong id** - 404, never 403 - so
probing cannot learn that a game exists.

**The result is computed once.** Scored inside the lock and refused afterwards,
because a tally that can be recomputed is a tally somebody can move: answer,
reveal, answer again, reveal again.

## What is deliberately not here

No streaks, no "come back now", no punishment for missing a day, no withheld
rewards. The pull is meant to be that your friends are in it and something new
happened, which is a reason to open something rather than a reason to feel bad
about not having.

## Verified

`a-game-strangers-can-join-by-link` drives the whole loop and every constraint
above. Checked against five mutations - the money refusal, one-answer-per-
player, reveal-once, the pre-reveal view, and ownership on close - each of which
fails the suite.
