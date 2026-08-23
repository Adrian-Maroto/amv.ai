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
