/* WRITING TO A RECORD THAT IS NOT YOURS IS ALWAYS A DECISION.

   Most handlers write under the caller's own key, where there is nothing to get
   wrong. A minority write somewhere else - into a team, a family, the other side
   of a link, a shared listing - and every one of those is a place where
   forgetting one comparison lets somebody change another person's account.

   That is not hypothetical here. familyRemove wrote familyOf out of an
   entitlement keyed by whatever address the caller named, so anybody who
   managed a family could free somebody else's child from their parent's
   spending limits.

   This check does NOT try to detect a missing ownership comparison. A version
   that did produced six false positives on the read side, and a checker that
   cries wolf is one somebody deletes. It does the thing a script is actually
   good at: it finds every route that writes outside the caller's own key and
   fails when one appears that nobody has classified.

   The list below is that classification. Adding a cross-account write means
   adding a line here, which means somebody looked at it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* One definition, in tests/lib/source.mjs. Three files carried an identical
   copy of this, each with its own 30000-character escape hatch - and a copy is
   a second definition that drifts silently. */
const bodyOf = (fn) => functionBody(src, fn);

/* Keys that ARE the caller, however the code spells it. */
const SELF = /user\.email|_autoKey\(|owner\b|\bme\b/;

/* Every cross-account write, and why it is allowed to be one. */
const CLASSIFIED = {
  authDeleteAccount: 'erasure reaches into the team, family and link records this account is part of',
  /* Newly VISIBLE rather than newly true: the thread write used a bare `key`
     variable, which neither pattern above could match, so a route that writes a
     record shared with another person sat outside this check entirely. A
     conversation belongs to both people in it, and _messageRecipient decides
     which conversation the sender is allowed to write to. */
  marketMessage:     'a conversation belongs to both people in it; the recipient is derived, never taken from the caller',
  /* Newly VISIBLE rather than newly true, like marketMessage above it. The
     review list used a bare `env.AMV_KV.put(key, ...)` with the key in a
     variable, which no pattern here could match - so a route that writes a
     record belonging to another person sat outside this check entirely. Moving
     it under the record lock (AMV-042) is what made it findable.

     Writing the seller's record IS the feature: a review is a buyer's statement
     about a seller, filed under that seller. What makes it safe is that the
     caller cannot choose what to say about whom without having bought from
     them - the handler refuses unless the buyer owns something of that
     seller's - and that the reviewer is stored as a one-way hash, so the list
     can be public without leaking an address. */
  marketReview:      'a review is a buyer\'s statement about a seller, filed under the seller; the handler refuses unless the buyer owns something of theirs, and the reviewer is stored as a hash',
  apiKeyCreate:      'the lookup row is keyed by a hash of the new key, not by a person',
  shareCreate:       'a share is keyed by its own generated id',
  shareVisibility:   'checks rec.owner before writing',
  autoCreate:        'key is _autoKey(caller)',
  autoUpdate:        'key is _autoKey(caller)',
  autoClearResults:  'key is _autoKey(caller)',
  autoPause:         'key is _autoKey(caller)',
  deploySite:        'a site is keyed by its slug, and the record carries the owner',
  familyRemove:      'requires the account to be in the caller\'s family, from either side',
  familyLeave:       'a child editing the parent record they are named in',
  linkAccept:        'both sides of a link the invitee was invited to, by emailed code',
  linkRevoke:        'both sides of a link the caller is one end of',
  fraudRecord:       'a rate-limited self-report into a global index, stamped with who wrote it',
  handoffAct:        'a bounded status on the sender\'s copy of a handoff in the caller\'s own inbox',
  teamCreate:        'the team is keyed by an id generated here',
  teamInvite:        'the invite is keyed by its own token',
  teamJoin:          'the team the invite names',
  teamRemove:        'role-checked team membership',
  teamLeave:         'the caller removing themselves',
  teamSetRole:       'role-checked',
  teamData:          'role-checked team data',
  teamShare:         'role-checked shared library',
  teamUnshare:       'role-checked shared library',
  teamPresence:      'presence keyed by team, written by a member',
  smsRegister:       'a short-lived verification row keyed by the address being verified',
  marketPublish:     'a listing keyed by an id generated here',
  marketInstall:     'an install counter on a public listing',
  marketWithdraw:    'a payout keyed by its own generated id',
  marketSetStatus:   'checks it.authorEmail before writing',
  marketRate:        'an aggregate rating on a public listing',
  /* Two cross-account writes and both are the point of the route rather than a
     slip. A report is BY one person ABOUT another person's listing, so it
     cannot be keyed to the caller: keying it to the reporter would scatter one
     listing's complaints across the accounts of everybody who complained, and
     would put those complaints inside the reported seller's own erasure scope
     if it were keyed the other way. It is keyed to the LISTING, the reporter is
     a one-way hash, and the seller cannot reach it. The second write hides the
     listing once enough different people have reported it - editing another
     person's record on purpose, which is what moderation is; it sets hidden
     rather than deleting, so the seller keeps the work and an operator
     decides. */
  marketReport:      'a report is about somebody else\'s listing by definition, so it is keyed to the listing and holds a hashed reporter; the second write hides that listing at the threshold, which is the moderation action itself',
  widgetConfigGet:   'the widget key comes from the caller\'s own widget_owner row',
  widgetConfigSave:  'the widget key comes from the caller\'s own widget_owner row',
};

const routes = [...src.matchAll(/case\s+'([^']+)'\s*:\s*return\s+([A-Za-z_$][\w$]*)\(/g)]
  .map(m => ({ path: m[1], fn: m[2] }))
  .filter(r => bodyOf(r.fn) && /requireUser\(/.test(bodyOf(r.fn)));

function writesElsewhere(b){
  const out = [];
  for(const m of b.matchAll(/DB\.put\(env,\s*'([a-z_]+)',\s*([^,]+),/g))
    if(!SELF.test(m[2])) out.push(m[1]);
  for(const m of b.matchAll(/env\.AMV_KV\.put\(`([a-z_]+):\$\{([^}]+)\}/g))
    if(!SELF.test(m[2])) out.push(m[1]);
  /* A write through the record lock is still a write. When the team and family
     routes moved inside _withTeam / _withFam the direct `DB.put` disappeared
     from every one of them, and this check stopped being able to SEE eight
     cross-account writes it had been watching - which is precisely the drift
     the stale-classification case exists to catch, and it caught it. */
  for(const m of b.matchAll(/_withTeam\(env,\s*([^,]+),/g))
    if(!SELF.test(m[1])) out.push('team');
  for(const m of b.matchAll(/_withFam\(env,\s*([^,]+),/g))
    if(!SELF.test(m[1])) out.push('fam');
  for(const m of b.matchAll(/_withAcct\(env,\s*([^,]+),/g))
    if(!SELF.test(m[1])) out.push('acct');
  for(const m of b.matchAll(/_withRecord\(env,\s*'([a-z_]+)',\s*([^,]+),/g))
    if(!SELF.test(m[2])) out.push(m[1]);
  /* The generic helpers, for the same reason as the two above: when nine record
     kinds moved inside them the direct put vanished from every one of those
     routes, and this check went blind to writes it had been watching. */
  for(const m of b.matchAll(/_withKind\(env,\s*'([a-z_]+)',\s*([^,]+),/g))
    if(!SELF.test(m[2])) out.push(m[1]);
  for(const m of b.matchAll(/_withKV\(env,\s*'([a-z_]+)',\s*([^,]+),/g))
    if(!SELF.test(m[2])) out.push(m[1]);
  /* And the named wrapper. _withAuto is the one function every write of an
     automation record goes through - it takes the same lock and books the
     due-time index from the record, so no caller can forget it. The kind is in
     the NAME rather than in an argument, which is exactly the shape that would
     have made this check go blind to five more routes: the third time this has
     happened, and the reason each helper is listed here as it appears. */
  for(const m of b.matchAll(/_withAuto\(env,\s*([^,]+),/g))
    if(!SELF.test(m[1])) out.push('auto');
  return out;
}

const crossers = routes.filter(r => writesElsewhere(bodyOf(r.fn)).length);

section('The cross-account writes were found');
{
  ok(crossers.length > 20, 'routes writing outside the caller\'s own key', crossers.length);
}

section('Every one of them has been looked at');
{
  const unclassified = [...new Set(crossers.map(r => r.fn))].filter(fn => !(fn in CLASSIFIED)).sort();
  ok(unclassified.length === 0,
     'no route writes to somebody else\'s record without anybody having decided that is right',
     unclassified);
}

section('And the classification has not gone stale');
{
  const live = new Set(crossers.map(r => r.fn));
  const gone = Object.keys(CLASSIFIED).filter(fn => !live.has(fn)).sort();
  ok(gone.length === 0,
     'nothing is excused here that no longer writes across accounts', gone);
}

section('The ones that guard by comparison still compare');
{
  /* Named individually: these are the routes whose safety IS one line, and the
     line is the kind that gets refactored away. */
  ok(/rec\.owner !== user\.email/.test(bodyOf('shareVisibility')),
     'shareVisibility still checks the share is yours', true);
  ok(/it\.authorEmail !== user\.email/.test(bodyOf('marketSetStatus')),
     'marketSetStatus still checks the listing is yours', true);
  ok(/not_in_family/.test(bodyOf('familyRemove')),
     'familyRemove still requires the account to be in your family', true);
}

if (report('cross-account-writes') > 0) process.exitCode = 1;
done();
