# Decision needed: company accounts (SCIM, SAML, roles)

Item 15 of the October audit list. These change how people sign in and who
can do what, so CLAUDE.md requires the owner's approval before any of it
ships. Nothing here has been built.

## What exists today

- Teams with three roles: owner, admin, member (`32-teams.js`,
  `33-team-roles.js`). Only the owner changes admins; the owner cannot be
  removed or demoted; every change is in the team's audit log.
- Company sign-in per team over OpenID Connect (`teamSso`): the domain is
  proved by DNS, only addresses at that domain are accepted, the id token is
  verified here, and "required" refuses passwords for the domain. This covers
  Okta, Microsoft Entra ID and Google Workspace.

## Recommendation

**1. Build SCIM 2.0 provisioning - Users only - once approved.**
This is the one that prevents damage. When somebody leaves a company, the
company's identity provider removes them from AMV within minutes and their
sessions end everywhere. Today that depends on a team admin remembering. At
scale, "forgot to remove the person who left" is a stadium of ex-employees
with access to company chats and files every week.

Scope: `/scim/v2/Users` (list, get, create, replace, patch `active`), a
per-team SCIM token shown once and stored only as a hash, deactivation that
ends every session of that account and removes it from the team, every call
in the team's audit log, rate-limited. Groups are left out of the first
version: they map to roles, and roles are point 3.

Needs from the owner: approval (it changes how accounts are created and
removed, and adds a new stored kind for the team's token).

**2. Take SAML off the table.**
The company sign-in AMV already has reaches the same identity providers.
SAML's XML signature checking is a classic source of sign-in bypass bugs
(signature wrapping), and doing it safely needs an XML-security dependency
this codebase deliberately does not have. Build it only when a paying
customer names it as a requirement - and then from a reviewed library, not
by hand.

**3. Do not add roles yet.**
The comfortable middle option - a handful of extra roles "for later" - is
the trap: every role is a permission rule that has to be right forever, on
every route. Add a role when a customer asks for a specific one (the likely
first is "billing manager": sees and pays invoices, nothing else).

## What the owner decides

- Yes or no to SCIM as scoped above.
- Whether a named customer needs SAML (if so, which identity provider).
