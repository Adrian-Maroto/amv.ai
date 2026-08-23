# D009: reduce and regroup Settings

## Measured, not remembered (2026-08-23)

`USER_SET_SECTIONS` holds **18 user panes and 5 owner panes**, which is the
finding exactly. The groups already exist and do no work:

| group | panes |
|---|---|
| General | **12** - account, privacy, security, billing, usage, capabilities, spending, investing, teamset, api, invite, family |
| Customize | 4 - appearance, language, skills, integrations |
| Workspace | **1** - projects |
| (divider) | about, then the five owner panes |

Two-thirds of the product's settings live under a heading that means "the rest".
A group holding twelve items is a list with a title, and a group holding one is
a heading with nothing under it.

Every pane, measured by what is actually in it:

| pane | group | controls | chars |
|---|---|---|---|
| invite | General | **0** | **180** |
| skills | Customize | 3 | 426 |
| projects | Workspace | 2 | 518 |
| security | General | 2 | 594 |
| appearance | Customize | 11 | 598 |
| about | - | 4 | 662 |
| usage | General | 1 | 715 |
| account | General | 7 | 795 |
| billing | General | 3 | 849 |
| api | General | 0 | 881 |
| investing | General | 0 | 955 |
| capabilities | General | 0 | 974 |
| language | Customize | 19 | 1120 |
| privacy | General | 5 | 1246 |
| teamset | General | 1 | 1353 |
| family | General | 11 | 2317 |
| spending | General | 1 | 2377 |
| integrations | Customize | 18 | 2415 |

`invite` is 180 characters and no controls at all. It is not a settings pane, it
is a button on the Team pane that was given its own address.

`api`, `investing` and `capabilities` show zero visible controls on a free
account - they are plan-gated and render an upsell. That is correct behaviour,
not emptiness, and it is why controls alone is the wrong measure of whether a
pane earns its place.

## What did NOT reproduce

A first pass at this reported a phantom pane with no id and no label sitting in
the Workspace group. There is no such pane: `{group:''}` is a deliberate divider
before About, and the renderer reads it with `s.group !== undefined`, which is
correct. **The parser in my measuring script treated an empty string as falsy
and invented the row.** Worth recording, because the measurement was going to be
the evidence for a change and it was wrong before anybody read it.

## The shape to build

Group by the question somebody is answering, so no group is "the rest":

| group | panes | from |
|---|---|---|
| **You** | Account, Privacy & security, Family | privacy + security merge |
| **Plan & usage** | Plan & usage, Spending limits | billing + usage merge |
| **What AMV can do** | Capabilities & skills, Connectors, API keys | capabilities + skills merge |
| **Workspace** | Team, Projects | invite folds into Team |
| **Preferences** | Appearance & language | appearance + language merge |
| **About** | About | |

**18 panes to 12**, five merges, and no group holding more than three.

Rules while doing it:
- Every existing pane id keeps working. Deep links (`S.settingsPane='billing'`)
  are set from at least six places in the product; a merged pane accepts the old
  ids and opens at the right section.
- Nothing is deleted. A merge means two sections on one pane, not one of them
  thrown away.
- Verified pane by pane on desktop and phone, against the same before/after
  measurement above.

## Swept for defects beyond D009, and what did not reproduce

D009 is the only NAMED finding for this surface whose text exists in the repo.
D010, D049, D067 and D068 are ids without content - only 33 of the 78 findings
are written down anywhere. Rather than guess at them, the surface was swept for
the defect classes that have actually produced findings elsewhere in this work.

**Inert controls: none.** All 29 controls on Appearance are live, and so is
every control on the other twelve panes.

**Horizontal scroll on a phone: none.** Thirteen panes at 390px, zero scroll the
page sideways.

**Tap targets: none under 40px.** Thirteen panes, zero.

### Three false alarms, all of them mine

Worth writing down, because each one looked like a finding right up until it was
checked:

1. A sweep reported **eight inert controls on Appearance**. Its signature
   watched the pane's own HTML, and Appearance's whole job is to change things
   OUTSIDE the pane - the root font size, an accent variable, the language.
2. A second sweep, with a wider signature, reported **nineteen inert language
   buttons**. It watched theme, accent and font size but not the language.
   Clicking `Français` moves `_lang()` from `en` to `fr`, writes storage and
   moves the selection. They were always live.
3. A layout sweep reported the **API keys pane overflowing by 40px** on a phone.
   The culprit was a `<code>` inside a `<pre class="ak-code">` that carries
   `overflow-x:auto`. A code block scrolling inside itself is correct, and fails
   "is any element wider than its container" every time. The page never
   scrolled.

The pattern is the same in all three: **the instrument measured a proxy and the
proxy was not the rule.** The rule is "the page must not scroll sideways", not
"no element exceeds its parent". The rule is "clicking this changes something a
person can perceive", not "the pane's innerHTML got longer".

The checks that survived are in `tests/e2e/settings-has-groups-that-do-work`,
written against the rules rather than the proxies.

---

# D013/D041-D044 groundwork: the token migration is an accessibility fix

Counted in `styles.css`:

| | rules |
|---|---|
| `font-size` hardcoded in px | **1,197** |
| `font-size: var(--t-*)` | 277 |

The audit frames this as consistency. It is not only that. At line 5098 the
scale is redefined:

    --fs-s: var(--fs-scale, 1);
    --t-xs: calc(11px * var(--fs-s));   ... and so on

`--fs-scale` is what the **text size setting** writes. So a hardcoded px value
does not merely skip a token - it **ignores the reader's text size preference
entirely**. Only tokenised text grows when somebody chooses Large or Largest.

That reframes the work: this is not tidying, it is making an accessibility
control do what it says.

## Which of the 1,197 can move without shifting a pixel

The scale is 11 / 12 / 13.5 / 14 / 16 / 20 / 26 / 34.

| px | rules | token | exact? |
|---|---|---|---|
| 11 | 154 | `--t-xs` | yes |
| 12 | 182 | `--t-sm` | yes |
| 13.5 | 69 | `--t-base` | yes |
| 14 | 79 | `--t-md` | yes |
| 16 | 27 | `--t-lg` | yes |
| **subtotal** | **511** | | **no visual change at scale 1** |
| 13 | 187 | nearest 13.5 | no - would shift |
| 12.5 | 156 | between 12 and 13.5 | no |
| 11.5 | 77 | between 11 and 12 | no |
| 15 | 42 | between 14 and 16 | no |
| 10.5 | 41 | below the scale | no |
| 10 | 43 | below the scale | no |
| 18 | 20 | between 16 and 20 | no |

**511 rules migrate with zero visual change at the default size, and start
responding to the text size setting.** That is the half worth doing, and it is
provable rather than argued: render every tab before and after and assert the
computed font size of every text element is identical.

The other ~686 shift type if migrated and need a decision - add tokens for the
in-between sizes, accept the shift, or leave them. That is the owner's call and
is NOT bundled into the safe half.
