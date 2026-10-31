/* ══════════════════════════════════════════════════════════════════════
   DATA SAFETY - backup & restore  (auditor #5)

   Every customer's account, subscription, chats, projects, and automations
   live in KV. Without a backup, one bad migration or an accidental namespace
   delete wipes all of it with NO recovery. These admin-only endpoints let you
   snapshot everything to a file and restore it.

   We back up the DURABLE data (accounts, entitlements, synced data, automations,
   teams, sites, abuse flags, wallets, purchases) and deliberately SKIP ephemeral
   keys (usage counters, rate-limits, presence, short-lived reset tokens) - those
   regenerate and would only bloat the snapshot.
   ══════════════════════════════════════════════════════════════════════ */

// Prefixes worth preserving. Everything else in KV is ephemeral/regenerable.
/* What a restore has to be able to put back.

   The test is "would losing this hurt, and can it be re-derived?". `consent` is
   the record that somebody accepted the terms - not re-derivable and the exact
   thing you need years later. `apikeys` breaks every integration a customer
   built. `fam` and `links` are relationships between accounts that nobody can
   reconstruct from memory. Those were all absent.

   Bank credentials are absent ON PURPOSE and must stay that way: `fin` holds a
   live access token to somebody's financial institution, and an admin-exported
   JSON file is the last place that should live. A restore leaves those accounts
   unlinked, which is a minor inconvenience and the correct trade. `invsnap` goes
   with them, being a record of real balances. */
/* THE EXPORT AND THE RESTORE HAVE TO AGREE, OR THE BACKUP IS NOT ONE.

   These lived only inside backupImport. The export applied no size limit at
   all, so a record larger than the restore would accept was written into the
   file, counted, and reported under `"complete":true` - and the restore then
   dropped it and answered `ok:true` with a 200. Measured end to end: seven
   records in, six out, and both halves said everything was fine.

   That is this file's own header defect moved one step downstream. The export
   was taught to abandon rather than finish short; the restore was not, because
   nothing had ever run the two together.

   Shared here so they cannot drift apart again. A limit the writer does not
   know about is not a limit, it is a trap laid for the worst day of the year. */
const BACKUP_MAX_VALUE_BYTES = 2 * 1024 * 1024;   // per record
const BACKUP_MAX_KEYS        = 500000;            // per snapshot

const BACKUP_PREFIXES = [
  'acct:', 'ent:', 'entitleitem:', 'data:', 'auto:', 'team:', 'userteam:',
  /* Which team signs a proved domain in. Restored with the teams, or every
     company's sign-in would stop until each owner proved their domain again. */
  'ssodom:',
  /* Which account each passkey belongs to - a public id and an address, no
     secret. The account record carries the keys themselves; without this
     index a restored deployment would have every passkey and none that work. */
  'pkcred:',
  /* Each pack of extra usage that was paid for - what a refund or a dispute
     is matched against, and what the bought total can be rebuilt from. */
  'creditpay:',
  /* Each account's named agents (77-agents.js) - what the person wrote for
     them. Their jobs are under auto:, so restoring one without the other
     would leave jobs whose agent no longer exists, and they would stop. */
  'agents:',
  'teamtasks:', 'sites:', 'site:', 'abuse:', 'seller:', 'widget:', 'market:',
  'wallet:', 'purchases:', 'stripecust:', 'tokepoch:', 'sms:', 'mktreport:',
  'consent:', 'apikeys:', 'billing:', 'fam:', 'links:', 'approvals:',
  'game:', 'gameown:',
  'handoff:', 'crewjobs:', 'share:', 'shares:', 'widget_owner:',
  /* Added after a check compared this list against every durable record kind
     and found these unbacked - each one silently unrecoverable from a restore. */
  'mktsnap:',   // what a buyer PAID for, snapshotted so a seller edit cannot revoke it
  'spendlimits:', // a restore without them resets everybody to the defaults, which is
                  // the permissive direction and the wrong way to be wrong
  'fraud:',     // the abuse assessments an operator would need after an incident
  'support:',   // open tickets; losing them loses the customers waiting on a reply
  /* Newly visible to the roster rather than newly durable: both used a bare
     namespace write until the lock moved them (AMV-042). They are real content
     that people wrote and that buyers read before deciding to spend - losing
     every rating and review in a restore would silently reset the reputation
     the marketplace runs on. Neither holds an address: the rater and the
     reviewer are stored as one-way hashes, which is what lets them be backed
     up and shown publicly without carrying somebody's identity along. */
  'mkrate:',    // ratings on a listing, keyed by the listing
  'mkreview:',  // reviews of a seller, keyed by the seller
  /* Same story again, one finding later: the team audit log used a bare
     namespace write until AMV-SP-05 moved it under the lock, so the roster
     could not see it. It is the record of who did what inside a team - who was
     invited, who changed a role, who removed whom. A restore that brings back
     the team and not its history leaves the owner unable to answer the one
     question an incident asks, and it is the cheapest record here: 200 lines a
     team, capped. */
  'teamlog:',   // a team's action history, keyed by the team
  /* A team's shared projects and their list - the team's work, edited by its
     members, and not something a restore should leave behind. */
  'tproj:', 'tprojidx:',
  /* The catalogue usage tally behind the most-used ranking. One record holding
     catalogue id to an integer and a total, nothing else: no address, no job
     text, no per-user timestamp, so there is nothing in it to protect and
     nothing that could be turned back into a person.

     It is backed up rather than excluded because it is the one kind here that
     genuinely cannot be regenerated. A rate-limit bucket or a cached catalogue
     rebuilds itself in a minute; months of "what did people actually turn on"
     does not, and a restore that dropped it would silently reset the ranking
     to "not enough data yet" with no way back. */
  'stats:',     // aggregate counts only, and unrecoverable if lost
  /* SEVENTEEN MORE, FOUND THE SAME WAY AND MISSED FOR ONE REASON.

     The check that produced the four above derives the record kinds from
     `DB.put(env, 'kind', ...)`. Everything written straight to the namespace -
     `env.AMV_KV.put(\`withdraw:${id}\`)` and its like - was invisible to it, so
     the list was exhaustive over records that go through one door and called
     itself exhaustive over durable records. The payout ledger was on the wrong
     side of that door.

     Money and identity first, because these are the ones that cannot be
     reconstructed from anywhere else: */
  'withdraw:',    // the payout ledger - who was paid what, and the tax record behind it
  'payoutyear:',  // what was paid per seller per calendar year, which a filing is built from
  'wallet_tx:',   // a seller's money history; wallet: was listed and its transactions were not
  'txn:',         // marketplace transactions
  'saleref:',     // charge reference -> sale, which is how a dispute finds what to reverse
  'kyc:',         // identity VERDICTS, not documents - losing them re-verifies everybody
  /* The reverse Stripe map. `stripecust:` (forward) was listed; without the
     reverse one, every later billing webhook arrives and cannot say who it is
     about, which is the exact failure AMV-084 was about. */
  'custemail:',
  /* Referral codes are permanent per account and live in links people have
     already shared, so a restore that reissues them breaks every one. */
  'refcode:', 'refmine:', 'refpend:',
  'waitlist:',    // people who asked to be told; losing them loses the launch list
  'mkthread:',    // marketplace conversations - the messages themselves
  /* The two indexes. They can be rebuilt from a scan, so losing them is
     recoverable - but the rebuild is the expensive scan they exist to avoid,
     and a restore is exactly when nobody wants every seller's first page load
     to walk the whole catalogue. */
  'mktmine:', 'mktinbox:', 'wdopen:',
  /* What somebody chose extra usage does when their plan runs out. A choice
     about their money: a restore that forgot it would start spending a
     balance somebody had set never to be used. */
  'creditpref:'
];
/* Never exported. Listed so the omission reads as a decision, not an oversight.
   Two reasons appear here: it is a CREDENTIAL and must not sit in a snapshot
   file, or it is genuinely ephemeral and regenerates on its own. */
/* A game and the index of who made it. Both are per-user data with a 30-day
   life, and a restore that brought back somebody's account without the games
   they were running would be a restore that lost work. The participants inside
   a game have no account of their own, so this is the only place their answers
   exist - which is also why erasing the creator takes them with it. */
const BACKUP_NEVER = [
  'fin:', 'finlink:', 'invsnap:',
  /* Sign-in in flight: a passkey challenge (five minutes), a second-step
     challenge (ten), and an authenticator app half set up, its secret sealed
     with this deployment's key. Restoring any of them would put a spent or
     expired step back into circulation. */
  'pkchal:', 'mfachal:', 'totpset:',
  /* Mail waiting to be retried (61-owner-digest.js, _outboxDrain): three
     days at most, and restoring it would send an old message again. */
  'outbox:',
  /* An agent's saved sign-ins (77a-agent-signins.js): other services'
     credentials, sealed. A backup is a second copy of them in a second place,
     and restoring one would bring back a sign-in somebody forgot. */
  'agentjar:',
  /* A signed request already taken (70-hooks.js): a month's memory that holds
     only a job id and a hash, kept so a captured request cannot run twice. */
  'hookdel:',
  /* A five-hour usage window held in storage when the counter object is not
     bound (07-atomic-counters.js): five hours of state at most. Restoring one
     would reopen a window that has already closed. */
  'ses:',
  /* Lifetime usage totals when no counter object is bound: aggregates that
     rebuild from use, and erased with the account. */
  'life:',
  /* Where the automation safety net's sweep and the renewal pass are up to -
     positions, not data. Restoring one would resume a pass over records that
     are no longer the ones it was counting. */
  'autosweep:', 'renewsweep:',
  /* Batches: work in flight and answers kept for a week. Restoring one would
     put a finished batch back in the queue - to be run, and charged, again. */
  'batch:', 'batchidx:', 'batchq:', 'batchreq:', 'batchres:', 'batchcursor',
  /* Which family invitations are waiting for somebody - ids only, gone in a
     day. The invitations themselves ('link:') carry the decision; this is the
     index a child's device reads to find them. Restored, it would point at
     invitations that expired long ago; not restored, the next invitation
     simply writes a fresh one. */
  'faminv:',
  /* A cache of other people's avatars. Restoring it would restore
     megabytes of pictures AMV does not own and that re-fetch themselves in a
     fortnight anyway. */
  'clogo:',
  /* A calendar subscription is a sealed URL, and whoever holds it can read the
     calendar - so it is the same class of thing as the bank token above it and
     goes the same way. There is a second reason too: it is sealed with the
     DEPLOYMENT's key, so a restore anywhere else brings back entries nothing
     can open, which is worse than bringing back nothing. Re-subscribing is
     thirty seconds of clicking; a credential in a backup file is forever. */
  'cal:',
  /* A cached page of the public connector directory. Nobody's data - it is the
     same answer for everyone and it rebuilds itself from the registry within
     six hours. Putting it in a backup would bulk up the file with a copy of
     somebody else's catalogue and restore a stale one. */
  'mcpcat:',
  /* A company sign-in in flight: ten minutes of state, nonce and verifier.
     Restoring one would put a spent sign-in back into circulation. */
  'ssost:',
  /* A mailbox app password opens the whole mailbox, and for most providers the
     account behind it. One leaked export file must not be a way into every
     connected inbox, so this is excluded on purpose rather than forgotten. */
  'mailcfg:',
  /* A bot token sends as somebody's own bot. Same rule as a mailbox password:
     never in a file anybody can download. */
  'telegram:',
  'goauth:',    // OAuth tokens - a backup file is the last place these belong
  /* Connected accounts. Sealed with AES-GCM already, so an export would carry
     ciphertext rather than tokens - and it is still excluded, because the point
     of a backup is that it can be restored somewhere, and a file that restores
     somebody's live mailbox grant onto another deployment is not a backup. */
  'conn:',
  /* A live approval for one web-agent action, alive for ten minutes and
     deleted the moment it is spent. Restoring one from a backup would hand
     back an approval for a purchase somebody authorised weeks ago on a page
     that no longer exists - which is the single thing an approval must never
     be, a licence that outlives the moment it was given. It is cheap to
     replace: the agent stops and asks again. */
  'webapproval:',
  /* The five-minute handshake record. It holds a sealed PKCE verifier, and it
     is single-use by design - restoring one from a backup would revive a
     handshake that was either already spent or long expired, which is at best
     meaningless and at worst a replay somebody has kept a copy of. */
  'connstate:',
  /* App connectors (Notion, Canva and the rest): the per-person sealed
     sign-in, the five-minute handshake, and AMV's registration with each app.
     Excluded for the reasons Connected accounts are - a backup restored onto
     another deployment must not bring live grants with it, and a registration
     re-creates itself on the next sign-in. */
  'rmcp:', 'rmcpstate:', 'rmcpcli:',
  /* A school access token, for the same reason as the bank link above it: a
     backup is a file somebody downloads, and one leaked export should not hand
     over a student's school account. A restore leaves Canvas unlinked, which is
     one reconnection and the correct trade. */
  'school:',
  /* An in-flight marketplace checkout: the payment session id and its URL,
     kept for a day so a double-click is handed the same checkout rather than a
     second card charge (AMV-009). Restoring one from a backup would send
     somebody to a session the provider has long since expired, and the cost of
     not having it is a new checkout. */
  'mktsess:',
  /* A short hold on a one-of-a-kind listing while somebody pays for it. It
     expires in minutes by design, so a restored one would take an item off the
     market for a purchase nobody is making. */
  'mktresv:',
  /* Where each connector got to for one account, and the ids of the messages
     AMV has already surfaced. Excluded on both counts.

     It is a record OF SOMEBODY'S MAILBOX - which message arrived when, and
     which ones were shown to them - so it does not belong in a file an admin
     downloads, by the same rule as every credential above it, even though it
     holds no credential.

     And losing it costs nothing worth insuring against: it is DERIVED, so a
     restore without it simply means each account is told about its newest mail
     once more. One repeated digest, against a permanent copy of everyone's
     message history sitting in an export. That is not a close trade. */
  'ingest:',
  'link:',      // pending invitations, minutes-long and carrying a confirmation code
  'presence:',  // who is online right now
  'errors:',    // worker diagnostics, regenerated by the thing that failed
  /* The rest of what the widened sweep turned up. Every one of these is a
     live credential with minutes on it, or state that regenerates: putting
     them in a downloadable file is the hazard, and losing them costs one
     retry. */
  'reset:', 'resetcode:',   // password-reset tokens - the credential itself
  'signincode:',            // a sign-in code challenge, ten minutes long, same reason
  'rtgrace:',               // when a refresh token was first used, kept two minutes for the overlap window
  'sess:',                  // a sign-in; restoring one would bring back a session somebody ended
  'emailhealth:',           // the provider's last refusal of the sender, re-learned on the next send
  'smsverify:',             // a phone confirmation code, same reason
  'invite:',                // a pending invitation with its code, like link: above
  'resume:',                // a half-finished answer, held for minutes
  /* apikey: was briefly on the OTHER list, reasoned as "these are only
     hashes". That is true about reading the file and wrong about restoring
     one. The record maps a hash to an account, so a planted row mints a
     working API key for whoever wrote the snapshot - which is exactly what
     a-restore-brings-it-back plants and expects to be refused, and it caught
     the change immediately. A backup is a file that gets IMPORTED, so
     "credential" has to mean both directions.

     The per-user index `apikeys:` stays in the backup on purpose: after a
     restore somebody sees which integrations they had and can reissue them.
     The keys themselves stop authenticating, which is the fail-closed
     direction and one afternoon of reconnecting. */
  'apikey:',
  /* The counters. `ctr:` and `rl:` are the KV fallback the Durable Object
     writes through when it is unbound, and both are windowed with a TTL - a
     rate-limit bucket for the current minute, a spend tally for the current
     day. Restoring yesterday's counters would either refuse people for use
     that already expired or hand back budget that was already spent. */
  'ctr:', 'rl:',
  /* The catalogue snapshot. Sixty seconds old by design and rebuilt on the
     first request after a restore - putting it in a backup would restore a
     stale front page and nothing else. */
  'mktcache:'
];

/* AMV-035: admin-token auth. Read the token ONLY from a header (never the
   request body - bodies get captured by logs, traces and error telemetry),
   compare in constant time, and FAIL CLOSED when ADMIN_TOKEN is unconfigured. */
/* ONE ADMIN GATE. There were two.

   _requireAdmin accepted Authorization: Bearer only; _adminTokenOK accepted
   that OR an X-Admin-Token header. Eighteen call sites split between them, and
   both were cryptographically sound, so nothing was broken today - which is
   precisely why it would have stayed that way. The hazard is drift: rate
   limiting, an audit line, an IP allowlist or a lockout added to "the admin
   check" would have covered a bit over half the admin surface, and the half it
   missed would have gone on working exactly as before.

   Both header spellings are still accepted, because both were in use and a
   deploy that suddenly rejects an operator's existing tooling is its own
   outage. What changes is that there is now one place to change. */
function _adminTokenOK(request, env){
  if(!env.ADMIN_TOKEN) return false;
  const hdr = String(request.headers.get('X-Admin-Token')
    || (request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''));
  if(!hdr) return false;
  return timingSafeEqual(new TextEncoder().encode(hdr), new TextEncoder().encode(String(env.ADMIN_TOKEN)));
}

/* Kept as the name eleven call sites use, now a single line over the one
   implementation rather than a second copy of the comparison. */
/* AMV-052: _requireAdmin used to live here, and it is DELETED rather than left
   unused. It was a bare "is this an admin" predicate, and three routes reached
   for it instead of the gate - which is how they ended up checking the token
   with no ceiling and no audit while the thirteen beside them had both. A
   convenience that is easier to call than the correct thing gets called; the
   fix is that there is no longer one to reach for. _adminGate is the only door. */

/* WRONG GUESSES ARE BOUNDED, AND SO IS THE EXPENSIVE ROUTE BEHIND THEM.

   Not one of the ten admin routes had a limit. The token is long and random so
   guessing it is impractical, and that is not the whole risk: every attempt is
   free to whoever is making it and costs AMV a request, and /admin/backup/export
   walks every record under every prefix - so a leaked or shared token turns
   into unlimited full-database dumps, which is a bill and a data-exfiltration
   rate rolled together.

   Keyed by source rather than by account, because an admin request that fails
   has no account behind it yet. Deliberately generous: a real operator
   refreshing a dashboard must never be the one who gets refused. */
/* The CEILING half, on its own, so the one caller that authenticates
   differently can have it without a way past the token check.

   The first version of this passed a `tokenAlreadyChecked` flag into
   _adminGate and returned early on it. That works and it is the wrong shape: it
   puts a `return null` in front of the token check, which is the exact thing
   every-route-decides refuses to allow - correctly, because the next caller to
   pass that flag by mistake walks straight through. There is no flag now.
   Splitting the function is the same code with no door in it. */
/* Who is asking, as a keyed hash rather than an address, in one place because
   both halves of the gate need it. */
async function _adminIp(request, env) {
  return (await _ipHash(env, request))
      || _rlIp(request);
}

async function _adminRateLimit(request, env, what, perMin, perDay) {
  const ip = await _adminIp(request, env);
  const lim = await limitAction(env, `admin:${what}:${ip}`, perMin || 30, perDay || 500);
  /* If the counter store itself is unreachable, do NOT refuse. These are the
     routes an operator needs during exactly that failure - readiness is the
     endpoint whose whole job is to report that storage is broken, and it must
     not be the first casualty of it. The token check below is untouched and
     still fail-closed, so this widens nothing to a stranger; it only declines
     to enforce a rate limit that cannot be evaluated, and writes that down. */
  if (!lim.ok && lim.unavailable) {
    audit(env, 'admin_limit_unavailable', { what });
  } else if (!lim.ok) {
    return json({
      error: lim.scope === 'day'
        ? "You've hit the daily limit for admin requests. Try again tomorrow."
        : "You're doing that too fast. Give it a moment.",
      code: lim.code,
    }, 429);
  }
  return null;
}

/* `what` NAMES THE ACTION, AND IT IS NOT DECORATION.

   It is the rate-limit bucket - `admin:<what>:<ip>` - and it is what a refusal
   is audited as. Every admin route passed 'read', including the ones that
   reset somebody's password, lift an abuse flag, mark a payout settled and
   change a plan. Two things followed from that and both are wrong.

   The audit log said `read` for every one of them, so a denied attempt to
   settle a payout was indistinguishable in the record from somebody loading a
   dashboard. An audit trail that cannot name the action is not an audit trail.

   And fifteen routes shared one counter. Opening the founder dashboard spends
   that allowance on reads, and the write somebody needs next is refused for a
   reason that has nothing to do with it - the money routes starved by the
   screen that shows the money.

   The numbers are unchanged on purpose: this separates the buckets and names
   the actions, it does not decide that an operator may do less. Tightening a
   limit an operator depends on is a different change and it is the owner's. */
async function _adminGate(request, env, what, perMin, perDay) {
  const limited = await _adminRateLimit(request, env, what, perMin, perDay);
  if (limited) return limited;
  if (!_adminTokenOK(request, env)) {
    /* A wrong token is worth knowing about: it is either an operator with a
       stale copy or somebody trying. Either way it should not be silent. */
    audit(env, 'admin_denied', { what, ip: await _adminIp(request, env) });
    /* 403 to match every other admin refusal in this file. The status is part
       of the contract - one surface answering 401 while the rest answer 403
       means a caller has to know which route it is talking to. */
    return json({ error: 'forbidden' }, 403);
  }
  return null;
}
async function _adminOk(request, env){
  return _adminTokenOK(request, env);
}

/* POST /admin/backup/export → a JSON snapshot of all durable data. */
async function backupExport(request, env){
  /* The most expensive route in the product: it reads every record under every
     prefix. Bounded tightly - a real operator takes a backup occasionally, and
     anything faster than that is either a script gone wrong or somebody
     draining the store through a token they should not have. */
  const gate = await _adminGate(request, env, 'backup', 10, 100);
  if (gate) return gate;

  /* AMV-038: STREAMED, AND HONEST ABOUT WHAT IT COULD NOT READ.

     Two things were wrong with building this in memory.

     It accumulated every record into one object and then JSON.stringify'd it,
     which is the whole store twice over inside a Worker with 128MB. That is
     survivable on a small deployment and it is not a property that holds - it
     fails at exactly the size where a backup starts to matter, and the operator
     finds out on the day they need the file.

     And the D1 half swallowed its errors. A kind that could not be read was
     dropped, silently, from a file that still announced itself as a backup with
     a key count. A restore from it comes back short and nothing anywhere says
     so. A backup that is quietly incomplete is worse than no backup, because it
     is the thing somebody trusts at the worst possible moment.

     So the file is written out as it is read, and a kind that fails ABORTS it.
     The stream is already flowing by then, so the abort cannot become a clean
     503 - it errors the response, which is what a half-written file must do:
     the download fails visibly rather than landing on disk looking complete. */
  let count = 0, bytes = 0;
  const failed = [];
  const enc = new TextEncoder();

  const body = new ReadableStream({
    async pull(controller) {
      const send = (s) => controller.enqueue(enc.encode(s));
      try {
        send('{"_amv_backup":1'
          + ',"createdAt":' + Date.now()
          + ',"createdISO":' + JSON.stringify(new Date().toISOString())
          + ',"prefixes":' + JSON.stringify(BACKUP_PREFIXES)
          + ',"data":{');
        let first = true;
        const emit = (key, raw) => {
          /* FOUND HERE, ON AN ORDINARY DAY, RATHER THAN DURING A RESTORE.

             A record the restore will refuse must not be written into a file
             that calls itself complete. Abandoning names the key, so somebody
             can go and look at it now, while the store is healthy - instead of
             discovering the gap at the moment they are trying to recover from
             something else. */
          if (raw.length > BACKUP_MAX_VALUE_BYTES) {
            failed.push(key);
            throw new Error('backup incomplete: ' + key + ' is ' + raw.length
              + ' bytes, larger than the ' + BACKUP_MAX_VALUE_BYTES
              + ' a restore will accept, so this snapshot could not be restored in full');
          }
          send((first ? '' : ',') + JSON.stringify(key) + ':' + JSON.stringify(raw));
          first = false;
          count++; bytes += raw.length + key.length;
        };

        for (const prefix of BACKUP_PREFIXES) {
          let cursor;
          do {
            const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
            for (const k of page.keys) {
              const raw = await env.AMV_KV.get(k.name);
              if (raw != null) emit(k.name, raw);
            }
            cursor = page.list_complete ? undefined : page.cursor;
          } while (cursor);
        }

        // When D1 is the source of truth, KV won't hold these records - pull
        // them from D1 too so the export is a COMPLETE recovery artifact.
        if (DB._hasD1(env)) {
          const seen = new Set();
          for (const prefix of BACKUP_PREFIXES) {
            const kind = prefix.slice(0, -1);
            try {
              for (const r of (await scan(env, kind, SCAN_ALL, 'backup export: ' + kind)).rows) {
                const key = `${kind}:${r.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                emit(key, JSON.stringify(r.value));
              }
            } catch (e) {
              /* Named, and then the whole file is abandoned. Reporting the gap
                 inside the file would be honest and useless: the person reading
                 it is a restore script. */
              failed.push(kind);
              throw new Error('backup incomplete: could not read ' + kind + ' from D1');
            }
          }
        }

        send('},"keyCount":' + count + ',"approxBytes":' + bytes + ',"complete":true}');
        audit(env, 'backup_export', { keyCount: count, bytes });
        controller.close();
      } catch (e) {
        audit(env, 'backup_export_failed', { keyCount: count, failed: failed.join(',') || 'read', why: String((e && e.message) || e).slice(0, 160) });
        try { await alertOnce(env, 'backup_failed',
          'A backup export failed part-way through and was abandoned rather than saved short. '
          + (failed.length ? 'Could not read: ' + failed.join(', ') + '. ' : '')
          + 'There is no usable backup from this attempt.', 30); } catch (_) {}
        /* Errors the stream. A download that stops mid-file is a download the
           operator can SEE failed - which a quietly short one is not. */
        controller.error(e);
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="amv-backup-${new Date().toISOString().slice(0,10)}.json"`
    }
  });
}

/* POST /admin/backup/import → restore keys from a snapshot.
   Body: { token, snapshot, mode }
     mode 'merge'    (default) - write snapshot keys, leave others untouched.
     mode 'missing'  - only write keys that don't currently exist (safe recovery,
                       never clobbers newer live data).
   We never auto-delete. Restores are additive by design so a restore can't
   itself destroy data. */
/* AMV-016: WHAT A RESTORE IS NOT ALLOWED TO UNDO.

   Returns the value to write, and whether something in the live record was held
   forward against the snapshot. Revocation is monotonic: it can be added by a
   restore and never removed by one.

   Deliberately narrow. A restore that quietly refused to write most of what it
   was given would be worse than one that overwrites too much - an operator has
   to be able to trust that a restore restores. These are the four facts that
   mean "this access was taken away", and nothing else is touched. */
async function _restoreMerge(env, key, incoming) {
  try {
    /* The token epoch is a bare counter and the rule is simply the larger one.
       Written as max rather than "keep the live one" so a restore can still
       carry an epoch FORWARD from a snapshot taken after the live store lost
       it - the point is that it never goes down. */
    if (key.startsWith('tokepoch:')) {
      const live = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
      const from = parseInt(incoming, 10) || 0;
      if (live > from) return { value: String(live), held: true };
      return { value: String(from), held: false };
    }

    const liveRaw = await env.AMV_KV.get(key);
    if (liveRaw == null) return { value: incoming, held: false };
    let live = null, from = null;
    try { live = JSON.parse(liveRaw); from = JSON.parse(incoming); } catch (e) { return { value: incoming, held: false }; }
    if (!live || !from || typeof live !== 'object' || typeof from !== 'object') return { value: incoming, held: false };

    let held = false;
    /* An account blocked for charging back stays blocked. */
    if (key.startsWith('ent:') && live.blocked && !from.blocked) {
      from.blocked = true;
      from.blockedReason = live.blockedReason || from.blockedReason || '';
      from.blockedAt = live.blockedAt || from.blockedAt || Date.now();
      held = true;
    }
    /* A suspended seller stays suspended, and strikes are not forgiven by a
       restore either - both are the record of a decision somebody made. */
    if (key.startsWith('seller:')) {
      if (live.banned && !from.banned) { from.banned = true; held = true; }
      if ((+live.strikes || 0) > (+from.strikes || 0)) { from.strikes = +live.strikes; held = true; }
    }
    /* A revoked API key is a credential somebody deliberately killed. Merged by
       id, so keys created after the snapshot survive the restore too. */
    if (key.startsWith('apikeys:') && Array.isArray(live.items) && Array.isArray(from.items)) {
      const byId = new Map(from.items.map((k) => [k && k.id, k]));
      for (const cur of live.items) {
        if (!cur || !cur.id) continue;
        const inSnap = byId.get(cur.id);
        if (!inSnap) { from.items.push(cur); held = true; continue; }
        if (cur.revoked && !inSnap.revoked) { inSnap.revoked = true; held = true; }
      }
    }
    return { value: held ? JSON.stringify(from) : incoming, held };
  } catch (e) {
    /* Unreadable live state means the comparison could not be made. Writing the
       snapshot over it anyway is the one thing that must not happen here, so
       the incoming value is kept as-is and the caller records that a restore
       ran - the alternative is silently deciding a revocation did not exist. */
    audit(env, 'restore_merge_failed', { key, error: String((e && e.message) || e).slice(0, 120) });
    return { value: incoming, held: false };
  }
}

async function backupImport(request, env){
  /* Writes arbitrary records back over live data, which makes an accidental
     repeat worse than a slow one. */
  /* Ten a minute rather than three: an operator legitimately runs several in a
     row - try a merge, check it, restore the full snapshot - and a limit that
     breaks the honest sequence is a limit that gets removed. Still a hard
     bound on a leaked token: nobody dumps or overwrites the store hundreds of
     times an hour through this. */
  const gate = await _adminGate(request, env, 'restore', 10, 100);
  if (gate) return gate;
  const body = await request.json().catch(()=>({}));
  const snap = body.snapshot;
  const mode = body.mode === 'missing' ? 'missing' : 'merge';

  if(!snap || snap._amv_backup !== 1 || !snap.data || typeof snap.data !== 'object')
    return json({ error:'not a valid AMV backup snapshot' }, 400);

  // Safety: only allow keys under known backup prefixes, so a tampered snapshot
  // can't write arbitrary control keys (e.g. GLOBAL_KILL).
  const allowed = (key) => BACKUP_PREFIXES.some(p => key.startsWith(p));

  // AMV-036: bound the import so a crafted/accidental snapshot can't exhaust
  // resources - cap the key count and reject oversized values.
  const entries = Object.entries(snap.data);
  if(entries.length > BACKUP_MAX_KEYS) return json({ error:'snapshot has too many keys to import safely' }, 413);

  /* TWO REASONS TO REFUSE A RECORD, AND THEY ARE NOT THE SAME EVENT.

     A key outside the backup prefixes is a TAMPERED snapshot being stopped
     from writing a control key - working as intended, and the count is just
     information. A record that is too large, or not a string, came out of a
     legitimate AMV export and is DATA BEING LOST during a recovery. One
     counter held both, so the second hid behind the first and the response
     said ok:true either way. */
  let restored = 0, skipped = 0, refused = 0, unrestorable = 0, heldForward = 0;
  const lost = [];
  for(const [key, val] of entries){
    if(!allowed(key)){ refused++; continue; }
    if(typeof val !== 'string' || val.length > BACKUP_MAX_VALUE_BYTES){
      unrestorable++; if(lost.length < 20) lost.push(key); continue;
    }
    if(mode === 'missing'){
      const existing = await env.AMV_KV.get(key);
      if(existing != null){ skipped++; continue; }
    }
    /* AMV-016: A RESTORE MAY NOT UNDO A REVOCATION.

       Everything here was a straight overwrite, which is right for data and
       wrong for anything that says somebody's access was TAKEN AWAY. A restore
       is normally run after an incident - which is precisely when the state
       being written over is the state created by responding to it.

       The sharp one is the token epoch. verifyToken compares a token's epoch
       against the stored number, and every "sign out everywhere" and every
       password reset increments it. Writing an older number back makes every
       token issued before that point valid again - so restoring a snapshot
       taken the day before a compromise hands the intruder their session back,
       silently, as part of the recovery.

       The same shape covers a revoked API key, an account blocked for charging
       back, and a suspended seller: all three are recorded ON the record a
       restore overwrites.

       Revocation only moves one way. */
      const merged = await _restoreMerge(env, key, val);
      if (merged.held) heldForward++;
      await env.AMV_KV.put(key, merged.value);
      /* The epoch's authority is the account's revocation object now, so a
         higher one from the snapshot is carried there too (it only ever
         rises). Failing is said: the restore otherwise holds. */
      if (key.startsWith('tokepoch:') && env.AMV_COUNTER) {
        try { await counter(env, _authName(key.slice(9)), { op: 'authSeed', floor: parseInt(merged.value, 10) || 0, strict: true }); }
        catch (e) { audit(env, 'restore_epoch_not_raised', { error: String((e && e.message) || e).slice(0, 120) }); }
      }
      /* THE ONE WRITER THAT DOES NOT GO THROUGH DB.put.

         Every other write to a scanned namespace passes through DB.put or
         DB.del, which drop the empty-namespace marker for us. This loop writes
         whatever keys the snapshot contains, straight to KV - so a restore that
         brings automations back while the marker still said the namespace was
         empty would leave them unscanned until the marker aged out. An hour of
         lateness rather than lost work, but a restore is run during an
         incident, which is the worst hour to add one to. */
      try{ const kind = String(key).split(':')[0]; if(kind) await _forgetKindEmpty(env, kind); }catch(_){}
    restored++;
  }
  audit(env, 'backup_import', { mode, restored, skipped, refused, unrestorable,
    lost: lost.join(',') || undefined, heldForward, from: snap.createdISO });
  if (unrestorable) {
    /* NOT ok. A restore that dropped part of the snapshot answered 200 and
       ok:true with the count buried in the body, so a recovery script saw
       success and an operator saw a number they had no reason to read. The
       whole point of this endpoint is the one day somebody is relying on it.

       Paged as well as returned, because the person running a restore is busy
       with whatever caused it and is the least likely reader of a JSON body. */
    try { await alertOnce(env, 'restore_incomplete',
      'A backup restore finished with ' + unrestorable + ' record(s) that could NOT be written: '
      + lost.slice(0, 5).join(', ') + (lost.length > 5 ? ' and more' : '')
      + '. The store is NOT a complete copy of that snapshot.', 5); } catch (e) {}
    return json({ ok:false, code:'restore_incomplete', mode, restored, skipped,
      refused, unrestorable, lost, heldForward,
      error: unrestorable + ' record(s) in this snapshot could not be restored, so the store is '
        + 'NOT a complete copy of it. They are named in `lost`. This is reported as a failure '
        + 'rather than a count, because a partial restore somebody believes was total is how a '
        + 'recovery quietly loses data.',
      snapshotFrom: snap.createdISO || null }, 422);
  }
  return json({ ok:true, mode, restored, skipped, refused, unrestorable: 0,
    /* Said out loud. An operator restoring a snapshot needs to know that some
       of it was deliberately not applied, and why - a silent partial restore is
       one they will assume was total. */
    heldForward,
    note: heldForward
      ? heldForward + ' record(s) were restored WITHOUT undoing a revocation, block or sign-out that happened after this snapshot was taken. Access that was taken away stays taken away.'
      : null,
    snapshotFrom: snap.createdISO || null });
}


/* Report an error that happened INSIDE the Worker itself. */
async function _workerError(env, where, err, extra){
  try{
    const idx = (await DB.get(env, 'errors', 'index')) || { groups:{} };
    /* SCRUBBED HERE TOO.

       AMV-037 scrubbed the PUBLIC sink, because that text arrives out of
       somebody's browser. It left this one - the SERVER's - reading raw, and
       this is the sink that sees actual credentials: an outbound call that
       fails quotes the URL it failed on, and some of those URLs carry the
       secret in them by the provider's design. Telegram's bot token is in the
       path; a signed provider URL carries its signature in the query.

       Unscrubbed, one failed send wrote a working bot token into KV in plain
       text, posted it to the operator's Slack through alertOnce, and forwarded
       it to Sentry - while the same token sat encrypted at rest two functions
       away. The stack matters as much as the message: a stack quotes whatever
       was in scope at the frame that threw. */
    const e = { kind:'worker', msg:_errScrub(String(err&&err.message||err), 300),
                where:String(where).slice(0,120), stack:_errScrub(String(err&&err.stack||''), 1200),
                tab:'server', ua:'worker', ver:'', at:Date.now(), ...(extra||{}) };
    _forwardSentry(env, null, e);   // inert unless SENTRY_DSN is set


    const fp = await _fingerprint(e);
    const g = idx.groups[fp] || { fp, msg:e.msg, where:e.where, kind:'worker',
                                  count:0, users:0, first:Date.now(), last:0, samples:[], userSet:[] };
    const isNew = g.count === 0;
    g.count++; g.last = Date.now(); g.msg = e.msg;
    if(g.samples.length < ERR_MAX_SAMPLES) g.samples.push(e); else g.samples[ERR_MAX_SAMPLES-1] = e;
    idx.groups[fp] = g;
    await DB.put(env, 'errors', 'index', idx);
    // Page the owner the FIRST time a given error appears, and again if it keeps
    // happening (throttled). This is how you find out prod broke before users do.
    if(isNew){
      await alertOnce(env, 'err:'+fp, `⚠️ New server error in ${e.where}: ${e.msg} (${e.count||1}x)`, 30);
    } else if(g.count === 25 || g.count === 250){
      await alertOnce(env, 'err:'+fp+':'+g.count, `🔁 Recurring error in ${e.where} hit ${g.count}x: ${e.msg}`, 60);
    }
  }catch(e){ /* never let error reporting throw */ }
}


