/* =====================================================================
   DURABLE DATA LAYER (auditor #2)
   System-of-record data (accounts, entitlements, teams, per-user data) should
   live in a real database, not KV (which is eventually-consistent and built
   for caching). This layer uses Cloudflare D1 (SQLite) when an env.DB binding
   is present, and transparently falls back to KV otherwise - so the app keeps
   working today, and turning on D1 is a config change, not a rewrite.

   D1 gives: strong consistency (no stale auth reads), real queries (the admin
   dashboard can COUNT/WHERE instead of listing every key), and no 25MB/key
   ceiling. KV stays for what it's good at: counters and rate-limit windows.

   BINDING D1 IS NOT ENOUGH TO USE IT - DATA_STORE = "d1" IS (scale audit,
   Oct 26). get/put below go to D1 alone once it is in use, with no
   read-through to KV, so on a deployment that already has data every record
   written before - every account, plan and wallet - would read as missing.
   That used to be a warning in this comment, and the switch was the binding
   itself: somebody adding [[d1_databases]] to try it out would have emptied
   every account at the next deploy. Now the binding alone changes nothing,
   and the switch is a separate, deliberate setting, flipped only after a
   migration (copy, verify counts and contents, shadow-read) has finished.

   D1 also refuses a row over 2,000,000 bytes, and a person's synced data is
   allowed to reach about 4 MB in one record. So put() refuses such a record
   here, by name, instead of letting the database refuse it somewhere less
   legible - and the migration is what has to split them first.

   To enable D1 on a NEW deployment with no data yet:
     wrangler d1 create amv
     wrangler d1 execute amv --command "CREATE TABLE IF NOT EXISTS kv (
       kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
       updated_at INTEGER, PRIMARY KEY (kind, id));"
     # bind as [[d1_databases]] binding = "DB" in wrangler.toml,
     # and set DATA_STORE = "d1" under [vars]
   ===================================================================== */
/* D1's own ceiling is 2,000,000 bytes a row; this leaves room for the other
   columns rather than finding the edge exactly. */
const D1_ROW_MAX_BYTES = 1900000;
const DB = {
  _d1Bound(env){ return !!(env && env.DB && typeof env.DB.prepare === 'function'); },
  _hasD1(env){ return this._d1Bound(env) && String(env.DATA_STORE || '').toLowerCase() === 'd1'; },
  /* A CORRUPT RECORD IS ONE BAD RECORD, NOT A BROKEN ACCOUNT.

     This parsed stored JSON with no guard, on the read that 135 call sites
     depend on - every account, entitlement, wallet, team, family, seller and
     school row goes through here. One malformed value therefore threw from
     inside whichever handler happened to touch it, and threw again on every
     retry, for ever: the person could not log in, could not be billed, could
     not be repaired through the product.

     It is not hypothetical. backupImport writes whatever JSON an uploaded file
     contains, a truncated write leaves a partial value, and a restore from a
     half-finished export leaves several. Other readers in this file already
     guard for exactly this reason (_wallet, _getListing); the one that matters
     most did not.

     Returning null is the honest answer: the record could not be read, which
     every caller already handles as "not there". It is also LOUD - a corrupt
     record is a real fault and silently treating it as absent is how somebody
     ends up recreated as a free user - so it is audited and alerted rather
     than swallowed. */
  async get(env, kind, id){
    let raw = null;
    if(this._hasD1(env)){
      const row = await env.DB.prepare('SELECT json FROM kv WHERE kind=? AND id=?').bind(kind, id).first();
      raw = row && row.json ? row.json : null;
    } else {
      raw = await env.AMV_KV.get(`${kind}:${id}`);
    }
    if(!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) {
      try {
        audit(env, 'record_unreadable', { kind, id, bytes: String(raw).length });
        await alertOnce(env, 'record_unreadable:' + kind,
          'A stored ' + kind + ' record could not be parsed, so it reads as missing. '
          + 'Something wrote invalid JSON - a truncated write, or a restore from a bad export. '
          + 'The account behind it will behave as though the record does not exist until it is repaired.', 30);
      } catch (_) {}
      return null;
    }
  },
  /* AMV-031: THE READS WHERE "MISSING" IS A PERMISSION.

     `get` above answers null for a record it could not parse, and for most
     callers that is right - the alternative is a person who cannot log in,
     cannot be billed and cannot be repaired through the product, which is the
     defect that answer was written to fix.

     It is exactly wrong for the handful of records where ABSENCE GRANTS
     SOMETHING. A `seller` row that will not parse reads as a seller who was
     never banned. An `abuse` row reads as somebody with no disputes. A `fam`
     row reads as a child with no spending limit. And an `acct` row reads as an
     address nobody has registered - which, since the signup that creates one
     now decides existence from this read, means a corrupt account record can be
     signed up over, with a new password, by anybody who knows the address.

     Every one of those fails OPEN, and every one of them is invisible: the
     record is corrupt, so nothing downstream can tell the difference between a
     clean answer and no answer at all.

     So these callers ask a question `get` cannot answer: not "what is in this
     record" but "is this record readable". A corrupt one throws, and the caller
     decides - refuse the signup, send the payout to review, apply the strictest
     limits - rather than being handed a null that means the opposite of the
     truth. */
  async getStrict(env, kind, id){
    let raw = null;
    if(this._hasD1(env)){
      const row = await env.DB.prepare('SELECT json FROM kv WHERE kind=? AND id=?').bind(kind, id).first();
      raw = row && row.json ? row.json : null;
    } else {
      raw = await env.AMV_KV.get(`${kind}:${id}`);
    }
    if(raw == null) return null;                 // genuinely absent, which is a real answer
    try { return JSON.parse(raw); }
    catch (e) {
      try {
        audit(env, 'record_unreadable_strict', { kind, id, bytes: String(raw).length });
        await alertOnce(env, 'record_unreadable:' + kind,
          'A stored ' + kind + ' record could not be parsed. This one decides whether somebody is allowed '
          + 'something, so it is being treated as unreadable rather than as absent - the request was refused '
          + 'instead of being granted by default. Repair the record.', 30);
      } catch (_) {}
      throw new UnreadableRecordError(`${kind}:${id}`, 'invalid JSON');
    }
  },
  async put(env, kind, id, obj, kvOpts){
    const j = JSON.stringify(obj);
    if(this._hasD1(env)){
      /* Characters are not bytes; only count bytes when it could matter. */
      if(j.length * 3 > D1_ROW_MAX_BYTES){
        const bytes = new TextEncoder().encode(j).length;
        if(bytes > D1_ROW_MAX_BYTES){
          try { audit(env, 'record_too_large_for_d1', { kind, bytes }); } catch (e) {}
          throw new Error('The ' + kind + ' record is ' + bytes + ' bytes, over the database\'s ' + D1_ROW_MAX_BYTES + '-byte limit for one record. It has to be split before it can be stored here.');
        }
      }
      await env.DB.prepare('INSERT INTO kv (kind,id,json,updated_at) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at')
        .bind(kind, id, j, Date.now()).run();
      return;
    }
    await env.AMV_KV.put(`${kind}:${id}`, j, kvOpts);
    /* This namespace is demonstrably not empty any more. */
    await _forgetKindEmpty(env, kind);
  },
  async del(env, kind, id){
    if(this._hasD1(env)){ await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, id).run(); return; }
    await env.AMV_KV.delete(`${kind}:${id}`);
    /* A delete can only make a namespace emptier - but "emptier" is not
       "empty", and the marker means ALL of them are gone. Only a completed
       scan may claim that, so drop the claim and let one prove it. */
    await _forgetKindEmpty(env, kind);
  },
  /* AMV-078: compare-and-set for a record that carries its own `_rev`.

     Read-merge-write is not atomic. Two devices that both read revision 5 in
     the same instant both believe they are up to date, both write revision 6,
     and the second one silently erases the first. The merge in syncPush
     narrows that to true simultaneity, but "narrow" is not "closed", and what
     is lost is the user's work.

     On D1 this is one conditional statement: the write lands only if the
     revision is still what we read. KV has no conditional write at all, so it
     degrades to a plain put and SAYS SO in `guarded` - the caller can then be
     honest about which guarantee it actually has, rather than assuming one it
     does not. */
  async putIfRev(env, kind, id, obj, expectedRev){
    const j = JSON.stringify(obj);
    if(this._hasD1(env)){
      const now = Date.now();
      // No previous revision means this must be the FIRST row, not an update -
      // otherwise a stale client with no rev could overwrite a live record.
      const stmt = expectedRev
        ? env.DB.prepare("UPDATE kv SET json=?, updated_at=? WHERE kind=? AND id=? AND json_extract(json,'$._rev')=?")
            .bind(j, now, kind, id, expectedRev)
        : env.DB.prepare('INSERT INTO kv (kind,id,json,updated_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM kv WHERE kind=? AND id=?)')
            .bind(kind, id, j, now, kind, id);
      const r = await stmt.run();
      const changed = (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 1;
      return { ok: changed > 0, guarded: true };
    }
    await env.AMV_KV.put(`${kind}:${id}`, j);
    await _forgetKindEmpty(env, kind);
    return { ok: true, guarded: false };
  },
  /* A ROW THAT COULD NOT BE PARSED IS NOT A ROW THAT IS NOT THERE.

     Both loops here were `try { out.push(JSON.parse(...)) } catch {}`, so an
     unreadable record was dropped and the caller received a shorter list with
     no way to know. `scan` above this is built entirely around the opposite
     principle - truncation is audited, alerted and handed back as a flag,
     because "nobody was told" is the failure it exists to prevent - and it was
     being fed by a reader that dropped rows in silence underneath it.

     Three things went wrong with that. An erasure scan reported success while a
     record it never saw survived. A backup export omitted the corrupt records,
     and a restore from that backup then deleted them for real. And worst,
     `scan` writes a durable "this namespace is empty" marker when it sees zero
     rows - so a kind whose records were ALL unreadable got marked empty, and
     every later scan skipped it by design.

     `_unreadable` is attached to the returned array rather than changing the
     return shape, because a dozen callers destructure it as a list and this is
     information about the read, not another element of it. */
  async list(env, kind, limit){
    const out = [];
    let unreadable = 0;
    const take = (id, raw) => {
      try { out.push({ id, value: JSON.parse(raw) }); }
      catch (e) {
        unreadable++;
        try { audit(env, 'record_corrupt', { key: `${kind}:${id}`, bytes: String(raw).length, where: 'scan' }); } catch (_) {}
      }
    };
    if(this._hasD1(env)){
      const rows = await env.DB.prepare('SELECT id,json FROM kv WHERE kind=? LIMIT ?').bind(kind, limit||1000).all();
      for(const r of (rows.results||[])) take(r.id, r.json);
      Object.defineProperty(out, '_unreadable', { value: unreadable, enumerable: false });
      return out;
    }
    let cursor;
    do {
      const page = await env.AMV_KV.list({ prefix: `${kind}:`, cursor, limit: 1000 });
      for(const k of page.keys){
        const raw = await env.AMV_KV.get(k.name);
        if(raw) take(k.name.slice(kind.length+1), raw);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while(cursor && out.length < (limit||100000));
    Object.defineProperty(out, '_unreadable', { value: unreadable, enumerable: false });
    return out;
  },
  /* EVERY id OF A KIND THAT STARTS WITH `idPrefix` - for records keyed by
     their owner (`<buyer>:<item>`, `<owner>|<id>`), so finding one person's
     costs a lookup of their own keys rather than a read of everybody's. */
  async idsWithPrefix(env, kind, idPrefix){
    const p = String(idPrefix || '');
    if(!p) return [];
    if(this._hasD1(env)){
      const rows = await env.DB.prepare('SELECT id FROM kv WHERE kind=? AND substr(id, 1, ?)=?').bind(kind, p.length, p).all();
      return (rows.results || []).map(r => r.id);
    }
    const ids = [];
    let cursor;
    do {
      const page = await env.AMV_KV.list({ prefix: `${kind}:${p}`, cursor, limit: 1000 });
      for (const k of page.keys) ids.push(k.name.slice(kind.length + 1));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return ids;
  },
  /* ONE PAGE, AND WHERE TO PICK UP. `list` above reads a whole kind into
     memory in one go, which is a cliff rather than a slope: at a few hundred
     thousand records the request runs out of memory or time, and a sweep
     that cannot finish covers nobody. A page is at most `max` records from
     `after` (a KV cursor, or the last D1 id), with the place to continue from
     - null at the end. Ordered on D1 so consecutive pages never overlap or
     skip; on KV the cursor is the store's own. */
  async page(env, kind, after, max){
    const out = [];
    const n = Math.max(1, Math.min(1000, max || 500));
    if(this._hasD1(env)){
      const rows = await env.DB.prepare('SELECT id,json FROM kv WHERE kind=? AND id>? ORDER BY id LIMIT ?').bind(kind, String(after || ''), n).all();
      const rs = rows.results || [];
      for(const r of rs){ try { out.push({ id: r.id, value: JSON.parse(r.json) }); } catch (e) {} }
      return { rows: out, next: rs.length === n ? rs[rs.length - 1].id : null };
    }
    const page = await env.AMV_KV.list({ prefix: `${kind}:`, cursor: after || undefined, limit: n });
    for(const k of page.keys){
      const raw = await env.AMV_KV.get(k.name);
      if(raw){ try { out.push({ id: k.name.slice(kind.length + 1), value: JSON.parse(raw) }); } catch (e) {} }
    }
    return { rows: out, next: page.list_complete ? null : (page.cursor || null) };
  },
};

/* AMV-182: a bounded scan that comes back exactly full has probably stopped
   short of the end, and each one of these is wrong in its own way when it
   does. The renewal sweep stops checking paying accounts past its limit, so a
   stable arbitrary subset is never revoked. An erasure leaves records behind
   and reports success. An admin screen shows a subset that looks like the
   whole list, and the operator counts it. The only thing they had in common
   was that NOBODY WAS TOLD - the flag was computed and dropped.

   So every bounded scan goes through here: the limit is enforced in one place,
   truncation is audited and paged once per window, and the caller gets the
   flag back so a screen can say "this is not all of it" rather than implying
   it is. `what` names the caller, because "a scan was truncated" is not
   actionable and "the renewal sweep was truncated" is.

   Scans that must be COMPLETE to be correct (erasure, backup) pass no
   practical limit and still come through here, so if one ever does hit the
   ceiling it surfaces instead of silently doing three quarters of the job. */
const SCAN_ALL = 1000000;
const ADMIN_USERS_LIMIT = 300;
/* One screenful. The per-account detail costs storage round trips, and a Worker
   has a ceiling on how many it may make in one request - so this is what bounds
   the admin list, not the number of accounts that happen to exist. */
const ADMIN_USERS_PAGE = 60;
/* How much school work one request will read. A student has a handful of
   courses; the bound is here so a Worker request cannot fan out into hundreds
   of Canvas calls. */
const SCHOOL_COURSE_MAX = 8;
/* AMV-050: a ceiling on ONE answer from a school's server. The host is whatever
   a student typed, so its size is not a number to trust. Two megabytes is far
   more than a page of Canvas JSON and far less than a Worker's memory. */
const SCHOOL_MAX_BYTES = 2 * 1024 * 1024;
const SCHOOL_ASSIGNMENT_MAX = 10;
/* How many views accumulate in the counter before they are folded back onto the
   listing. One write per fifty instead of one per view. */
const MKT_VIEW_FOLD = 50;      // one admin page of accounts
const SUPPORT_SCAN_LIMIT = 500;     // accounts with tickets, not tickets
/* AN IDLE DEPLOYMENT WAS PAYING THE MOST, FOR EVER.

   runDueAutomations has a cheap index - `duehour:` buckets naming the accounts
   with work due in this hour and the two before it - and one safety rule over
   the top of it: an EMPTY bucket set is never believed, because "nobody is due"
   and "the index does not know" look identical, and the second one must not
   silently stop somebody's nightly job. Empty therefore falls through to a full
   scan of the namespace.

   Which is correct for a busy deployment and exactly inverted for a new one.
   With no automations at all the buckets are empty on every tick, so the
   fallback ran EVERY time: the cheap path can never engage precisely when there
   is no work to be cheap about. reconcilePayments had the same shape with no
   index at all - its comment says "cheap when there is nothing pending", which
   is true of the bytes read and false of the operation count, because a list is
   one list whether it returns nothing or a thousand rows.

   Measured against the real Worker: 2 lists and 49 reads per tick, 288 ticks a
   day, with nobody signed up. 576 list operations - 58% of a free plan's daily
   allowance - spent rediscovering that the product is empty. The owner's KV
   usage sat at 90% with zero users.

   So: a marker that separates "the index has no idea" from "there are no
   records at all". The second is a FACT rather than a guess, because it is
   written only by a scan that walked the whole namespace and found nothing, and
   it is thrown away by any write that would make it wrong.

   Three properties matter, and they are why this is safe:

   - It cannot lose work, only delay it. The marker is trusted for under an
     hour, and runDueAutomations already forces a full sweep in the first five
     minutes of every hour and ignores the marker while doing it. A marker that
     somehow went stale costs one hour of lateness, which is reported, and then
     self-heals. Compare the failure it replaces: none, but the deployment stops
     working entirely when the daily limit is hit, which stops automations AND
     payment reconciliation AND the owner dashboard at once.
   - Only the two kinds the cron scans carry it. DB.put is the write path for a
     hundred and thirty-five call sites; invalidating a marker there for every
     kind would add a delete to every account, entitlement and usage write and
     cost more than it saves. `auto` and `paypending` are written when somebody
     saves an automation or starts a checkout - rare, deliberate, one at a time.
   - It trades the scarce operation for the abundant one. Free KV allows 100,000
     reads a day and 1,000 lists. This spends a read to avoid a list. */
const KIND_EMPTY_PREFIX = 'kindempty:';
/* Under an hour on purpose, so the marker expires in step with the hourly full
   sweep rather than outliving it. */
const KIND_EMPTY_TRUST_MS = 55 * 60 * 1000;
/* The kinds the 5-minute tick scans, and the ONLY kinds this applies to. */
const CRON_SCANNED_KINDS = new Set(['auto', 'paypending']);

/* D1 is a real database: `SELECT ... WHERE kind=?` costs nothing like a KV
   list, and there is no daily operation ceiling to protect. On that path the
   marker would be pure overhead - a KV read added where there was no KV op at
   all - so every one of these is a no-op there. */
async function _markKindEmpty(env, kind){
  if(!CRON_SCANNED_KINDS.has(kind) || DB._hasD1(env)) return;
  try{ await env.AMV_KV.put(KIND_EMPTY_PREFIX + kind, String(Date.now()), { expirationTtl: 86400 }); }
  catch(e){ /* best effort: failing to record emptiness only costs a scan */ }
}
/* AWAITED, not fired and forgotten.

   The first version registered the delete with waitUntil and returned - which
   meant reaching forward to `_liveCtx`, declared several hundred lines below
   this, from inside a catch that swallows. Top-level order dependencies are
   real in a concatenated single script, and a TDZ error in there would have
   been invisible: the marker would simply never be dropped, and an automation
   would never run.

   Awaiting is both simpler and a stronger guarantee. It costs one KV delete on
   a write that only happens when somebody saves an automation or starts a
   checkout, and it means the stale marker is provably gone BEFORE the caller
   is told the record was written - rather than probably gone, shortly. */
async function _forgetKindEmpty(env, kind){
  if(!CRON_SCANNED_KINDS.has(kind) || DB._hasD1(env)) return;
  try{ await env.AMV_KV.delete(KIND_EMPTY_PREFIX + kind); }
  catch(e){ /* the scan it would have saved simply happens */ }
}
async function _kindKnownEmpty(env, kind){
  if(!CRON_SCANNED_KINDS.has(kind) || DB._hasD1(env)) return false;
  try{
    const at = +(await env.AMV_KV.get(KIND_EMPTY_PREFIX + kind)) || 0;
    const age = Date.now() - at;
    /* BOUNDED FROM BOTH SIDES, AND THE SECOND SIDE IS THE ONE THAT MATTERS.

       This first read `at > 0 && age < KIND_EMPTY_TRUST_MS`, which looks like
       it rejects a bad value and does not. Unparseable text and 0 both land on
       at=0, giving an age of fifty-odd years, which the upper bound already
       refuses - so `at > 0` could never once have changed the answer. A
       mutation run proved it: removing it left all thirty-six assertions
       passing.

       What neither clause caught is a timestamp in the FUTURE. That gives a
       NEGATIVE age, which is happily less than the trust window, so the marker
       would be believed until the clock caught up with it - months, and the
       hourly sweep is the only thing that would still find the work. Not
       theoretical: backupImport writes whatever keys a snapshot contains
       straight to KV, and a snapshot is operator-supplied JSON, so
       `kindempty:auto` can arrive holding any number at all.

       So the age is bounded below as well. A marker from the future is not a
       marker from the past. */
    return age >= 0 && age < KIND_EMPTY_TRUST_MS;
  }catch(e){ return false; }
}

async function scan(env, kind, limit, what) {
  const cap = limit || SCAN_ALL;
  const all = await DB.list(env, kind, cap);
  /* The underlying list reads a page at a time and can overshoot the cap by up
     to a page, so the cap is applied here. Without this the limit was advisory
     and a caller that promised "the first N" could hand back N plus a bit. */
  const truncated = all.length >= cap;
  const rows = truncated ? all.slice(0, cap) : all;
  if (truncated) {
    audit(env, 'scan_truncated', { kind, limit: cap, what });
    try {
      await alertOnce(env, 'scantrunc:' + what,
        'A SCAN STOPPED SHORT. "' + what + '" read ' + cap + ' "' + kind + '" records and there are more, '
        + 'so everything past that point was not looked at. Whatever this scan is responsible for has NOT '
        + 'been done for those records, and will not be on the next run either - the cut-off is in the same '
        + 'place every time. Raise the limit for this scan or page it.', 12 * 60);
    } catch (e) {}
  }
  /* Only a walk that found nothing may claim the namespace is empty.

     This read `!truncated && rows.length === 0`, and the first half was
     unreachable: `truncated` is `all.length >= cap` and `rows` is
     `all.slice(0, cap)`, so a truncated scan carries at least `cap` rows and
     cap is never zero. Zero rows already means the walk completed. Removing
     the clause changed no test, which is the definition of a guard that was
     never guarding - so it is gone rather than left standing as protection
     that is not there. */
  /* Records this walk could see but could not read. They exist, so whatever
     this scan is responsible for has not been done for them - the same
     statement truncation makes, about a different set of rows. */
  const unreadable = +(all._unreadable || 0);
  if (unreadable) {
    audit(env, 'scan_unreadable', { kind, unreadable, what });
    try {
      await alertOnce(env, 'scanunread:' + what,
        'RECORDS COULD NOT BE READ. "' + what + '" walked "' + kind + '" and ' + unreadable + ' record(s) '
        + 'would not parse, so they were skipped. They still EXIST - whatever this scan does has not been '
        + 'done for them, and a backup taken now will not contain them. Check the audit log for '
        + 'record_corrupt entries naming this kind.', 12 * 60);
    } catch (e) {}
  }
  /* Only a walk that found nothing may claim the namespace is empty - and a
     walk that skipped something did not find nothing. Without this, a kind
     whose records were all unreadable got a durable empty marker and every
     later scan skipped it entirely, which turns a recoverable corruption into
     data nothing will ever look at again. */
  if (rows.length === 0 && !unreadable) await _markKindEmpty(env, kind);
  return { rows, truncated, unreadable };
}

// Per-plan limits (TUNE THESE to protect margin). Tokens/day, tokens/month.
/* ── THE ONE NUMBER THAT DECIDES WHETHER A LARGE CAP IS SAFE ──────────────
   A cap beyond what a person can reach costs nothing while almost everybody
   sends a few hundred messages a month. It costs everything if the heavy share
   grows. The arithmetic is brutal and worth writing down: with a typical
   account at four hundred messages, one percent of accounts running to the cap
   still leaves a healthy margin, two percent leaves almost none, and five
   percent loses money on every subscriber in the book.

   So the business does not turn on the cap. It turns on the SHAPE of the
   distribution, and nothing here was measuring that shape - which meant the
   cap was safe by assumption rather than by observation.

   Break-even is per plan, because it is the plan's own price that funds it,
   and it is computed rather than typed so it moves when a price or a rate
   does. The overhead share is everything that is not compute - payment fees,
   tax, infrastructure, support, the people - because gross margin on tokens is
   not margin, and a number that ignores the rest of the business is a number
   that will be wrong in the direction that hurts.

   COST PER MESSAGE IS AN ESTIMATE AND IS LABELLED ONE. The usage report
   measures the real figure per account; this constant is what the alarm uses
   until there is enough of that to replace it. It is here, named, so it can be
   argued with and tuned rather than living in somebody's head. */
const COHORT_OVERHEAD_SHARE = 0.30;
const COHORT_COST_PER_MESSAGE_USD = 0.00407;
const COHORT_HEAVY_SHARE_ALARM = 0.02;     // two percent is where the margin goes
const COHORT_MIN_ACCOUNTS = 50;            // below this a share is noise, not a signal

/* How many messages this account can send before it stops paying for itself.
   Zero for a plan with no revenue behind it - a free account has nothing to
   break even against, so it is never counted as heavy. */
function _breakEvenMessages(user) {
  /* NO GUARD HERE, AND THAT IS CHECKED RATHER THAN ASSUMED.

     There was one, and it was dead twice over. A free plan prices at zero and
     the arithmetic returns zero by itself; a corrupted custom config cannot
     produce NaN either, because _planPriceUSD ends in `|| 0` and so is
     incapable of returning anything but a finite, non-negative number. Two
     separate attempts to justify the line failed against that, which is the
     line's own argument for not being here.

     The property it was reaching for is real and is worth keeping, so it is
     asserted next door instead: this never returns NaN, and a plan with no
     revenue behind it never counts as heavy. Both are true because of where
     the price comes from, and a test says so - which is a better guarantee
     than a branch that can never be taken. */
  const price = _planPriceUSD(user.plan, user.customCfg);
  return Math.floor((price * (1 - COHORT_OVERHEAD_SHARE)) / COHORT_COST_PER_MESSAGE_USD);
}

/* ── MESSAGES, WHICH IS THE UNIT ANYBODY ACTUALLY COMPARES ────────────────
   Nobody shopping for this counts tokens. They count messages, because that is
   what every product they might buy instead publishes, and a token figure is
   not comparable to any of them.

   THE CAPS ARE DELIBERATELY UNREACHABLE BY A PERSON, and that is what makes
   them honest rather than a bluff. A hundred thousand messages in a month is
   one every 8.6 seconds, eight hours a day, every day, without stopping. No
   human does that, so no human meets this limit - which is the point. What
   stops the business losing money is not a small number here; it is the
   automation detection and the per-minute throughput limit that already exist,
   plus the shape of the distribution: a typical account sends about four
   hundred messages a month, and break-even on the cheapest paid plan is around
   two and a half thousand.

   So the cap is set where only a script can reach it, and a script reaching it
   is an abuse question rather than a billing one.

   Message count is therefore NOT what separates the tiers, because a number
   nobody reaches cannot separate anything. What separates them is which engine
   they run, how fast they may run it, and what they unlock. That is also the
   honest story: the difference somebody is paying for is the quality of the
   answer, not permission to ask more often.
   ───────────────────────────────────────────────────────────────────────── */
const PLAN_LIMITS = {
  // Token allowances per plan. These are sized to be GENEROUS for real usage
  // (a heavy day of chatting/coding is well under the daily cap) while keeping a
  // healthy margin at worst case - the plan price is decoupled from raw token
  // cost, the way every subscription AI product prices. The 45% backstop below is only an
  // anti-abuse floor that normal users never reach. Blended compute ~$6/Mtok:
  //   pro   $15  -> ~1.8M/mo ≈ $11 worst-case compute (~27% floor, usually far higher margin)
  //   elite $75  -> ~7M/mo, ultra $200 -> ~18M/mo - all comfortably profitable.
  /* AMV-072: these allowances are counted in TOKENS, but a token is not a fixed
     amount of work - it depends on the tokenizer. The current-generation engine
     tokenizes the same English text into roughly 30% more tokens than the one
     these numbers were calibrated against. Left alone, every user's real
     allowance would have quietly shrunk by about a quarter for identical work,
     as a side effect of a model upgrade they never asked for and cannot see.
     So the caps are scaled by the same ratio: the allowance is denominated in
     WORK, not in a unit that moved underneath it.

     Margin is unaffected. The real profit guarantee is the dollar backstop
     (planPrice * 0.45 of model cost), which is enforced separately and is now
     priced correctly - these token caps are a secondary anti-abuse guard. */
  /* THE FREE TIER USED TO DIE ON DAY SIX.
     dayTokens was 52,000 against a monthly 325,000, so a day at the cap
     exhausted the month in 6.2 days - against a monthly average of 10,833. An
     engaged new account explored hard for a week and was locked out for three,
     and the people that hits hardest are the ones most likely to convert.
     The blurb said "Daily usage to explore everything".

     The MONTHLY budget is unchanged, so this costs nothing and the margin is
     identical. Only the shape moved: a day at the cap now lasts 16.2 days
     instead of 6.2, and 20,000 tokens is still a long session rather than a
     taste. What it costs is a single day's peak, 52,000 down to 20,000, which
     is the trade for not being locked out for three weeks.

     Deliberately NOT a welcome window that scales the first days. `createdAt`
     is on the account record but not on the request path, so that needs new
     plumbing and a fallback for records without it - machinery for a smaller
     gain than the one line below. */
  free:  { dayTokens: 20000,    monthTokens: 325000,    rpm: 8,   monthMessages: 3000,
           messages5h: 25,     topMessagesWeek: 0 },
  /* WHAT THESE ARE MEASURED AGAINST, WRITTEN DOWN THIS TIME.

     The note above calls the dollar backstop a floor "normal users never
     reach", and nothing had ever checked it. Checking it produced a scare and
     then a correction, and both are worth recording because the second one is
     easy to get wrong in the same direction twice.

     THE SCARE: priced at the dearest engine with no cache hits, a Pro month of
     2.34M tokens costs about $32 against a $6.75 backstop, so the account
     would stop at a fifth of what was sold. THE CORRECTION: that basis is not
     what a month actually bills at. The router sends short turns to the
     cheapest engine and most turns to the balanced one, and the proxy caches,
     so half the input is served at a tenth of the rate. On that footing the
     same 2.34M costs between $5.60 and $9, and the token cap is what binds
     first - which is exactly what the note above claims.

     The caps were briefly cut to the worst-case figure. That was wrong and the
     suite next door said so in one line: a Pro day went from 192 real turns to
     40. An allowance has to be sized for how the product actually runs, not
     for an adversarial reading of it - the dollar ceiling is what handles the
     adversarial reading, and that is its whole job.

     So these stand, and what changed is that the basis is now stated and
     tested rather than assumed. Where the backstop DOES bind first - somebody
     running the top engine for every single turn - it is meant to. That is not
     a customer being short-changed; it is the anti-abuse floor doing the thing
     it exists for. */
  /* THE WEEKLY NUMBER IS THE ONE DOING THE WORK.

     The dearest engine costs about two and a half cents a message. A hundred
     of those a week is roughly ten dollars and fifty cents a month, which is
     exactly the compute budget a fifteen dollar plan has after overhead - so
     the worst case a Pro customer can produce lands on the budget rather than
     through it. That is what makes "the best engine at the cheapest paid
     tier" a sentence that survives contact with the invoice.

     The five-hour number is not a rationing device and is not meant to bind.
     It is set where only a burst reaches it, so a person working hard for an
     afternoon never meets it. */
  pro:   { dayTokens: 325000,   monthTokens: 2340000,   rpm: 20,  monthMessages: 100000,
           messages5h: 1000,   topMessagesWeek: 100 },
  elite: { dayTokens: 1170000,  monthTokens: 9100000,   rpm: 40,  monthMessages: 300000,
           messages5h: 3000,   topMessagesWeek: 500 },
  ultra: { dayTokens: 2860000,  monthTokens: 23400000,  rpm: 80,  monthMessages: 1000000,
           messages5h: 10000,  topMessagesWeek: 1300 },
};
/* The ratio above, named so it is a decision rather than a magic number. If the
   engine line changes again, re-measure with count_tokens rather than guessing. */
const TOKENIZER_SCALE = 1.30;

/* How much of the global daily spend cap the FREE tier is allowed to reach.
   Paying accounts get all of it. Below this, everybody is served; above it, the
   free tier is shed first and customers who have paid keep working - which is
   the only order that is not a refund waiting to happen. */
const FREE_TIER_CAP_SHARE = 0.7;

/* AMV-199: WHAT A PICTURE AND A VIDEO COST.

   The daily spend cap exists because a runaway bill kills a company faster than
   no customers. It was checked on chat and on the widget, and the counter it
   reads was incremented by the stream meter and the automation tick. Image and
   video generation - the two most expensive calls AMV makes, by an order of
   magnitude per call - did neither. They never asked the ceiling for
   permission, and their cost never reached the number the ceiling reads.

   So the control could not see the spend most likely to run away; the owner's
   daily spend figure understated the real bill; and the per-account cost and
   the unprofitable-accounts list left out the accounts most likely to be on it.
   A number that is quietly wrong is worse than one that is missing.

   These are list prices, overridable per deployment because providers change
   them and a stale constant is how a cap silently stops meaning what it says.
   They are deliberately not free to be zero: a cost of nothing would restore
   exactly the blindness this closes. */

/* THE CEILING ON ONE ACCOUNT'S MONTH, IN ONE PLACE.

   The plan's own cost backstop and a parent's monthly limit are the same kind
   of number - a dollar ceiling on what this subject may spend in a month - and
   the lower of the two always wins. A parent can spend less on a child than
   the plan allows; they can never spend more, whatever the plan is or who pays
   for it.

   This lived only inside the chat handler, so it bound chat and nothing else.
   The image and video paths were bounded by a COUNT from the plan - so many
   images a day - and a count is not a dollar limit: a parent who set $10 a
   month still had a child able to run the plan's full daily image allowance
   every day, and video at fifty cents a call. The limit was real on the one
   path that happened to contain the code.

   Returns null when this subject has no dollar ceiling at all. */
function _monthlyCeiling(user) {
  const planCeiling = _planPriceUSD(user.plan, user.customCfg) > 0
    ? _planPriceUSD(user.plan, user.customCfg) * 0.45 : 0;
  /* A child's cap is a ceiling on top of the plan's, never a raise. The parent
     can spend less on them than the plan allows; they can never spend more,
     whatever the plan is or who pays for it. */
  let familyCapUSD = null;
  if (user.family && user.family.limits && user.family.limits.monthlyUSD != null) {
    familyCapUSD = Math.max(0, +user.family.limits.monthlyUSD || 0);
  }
  if (!(planCeiling > 0) && familyCapUSD == null) {
    return { value: null, source: null, planCeiling, familyCapUSD };
  }
  /* A cap of zero really is zero - a parent who sets it there has switched off
     paid compute for that child, and that has to mean it. */
  const value = familyCapUSD == null ? planCeiling
       : (planCeiling > 0 ? Math.min(planCeiling, familyCapUSD) : familyCapUSD);
  /* AMV-005: WHICH ceiling bound, not only what it was.

     The refusal has to name the right person. "Upgrade for more" is not an
     action a child can take, and telling a parent to ask themselves is
     nonsense. The caller used to work this out again from its own copy of
     familyCapUSD and a `planCeiling` that existed only in THIS function - so
     the family branch threw a ReferenceError and the customer got a 500 where
     a 429 belonged, on the one path where somebody is already being told no.

     Deciding it here means there is one computation and one answer. */
  const source = (familyCapUSD != null && (planCeiling === 0 || familyCapUSD <= planCeiling))
    ? 'family' : 'plan';
  return { value, source, planCeiling, familyCapUSD };
}

/* The value alone, for the callers that only gate on it. */
function _monthlyCeilingUSD(user) { return _monthlyCeiling(user).value; }

/* AN ACCOUNT BLOCKED FOR TAKING ITS MONEY BACK DOES NOT GET MORE.

   `blocked` is set by _abuseRecord on a chargeback or a refund pattern, and it
   was read in exactly two places: whether a new checkout could start, and
   whether a referral paid out. Neither of those is where the money goes. So
   somebody blocked for charging back went on calling the model, generating
   images, texting, running scheduled work and serving a widget - every one of
   them a real invoice AMV pays - having already demonstrated they take the
   money back afterwards. The block stopped them BUYING and did nothing about
   them SPENDING, which is the wrong half.

   One named helper rather than a condition repeated per path, because the
   thing being asserted about this fix is that every path asks, and a copy in
   six places is six chances for the seventh to be forgotten silently.

   It answers 403 rather than 402 or 429: this is not a limit that resets and
   not a payment that can be made, it is a decision about the account, and the
   client must not read it as "try again" or as an expired session. The message
   says what happened and where to go without naming the reason - that is on
   the account for support to read, not for somebody probing to learn which
   signal tripped. */
const ACCOUNT_HOLD_MESSAGE =
  'This account is on hold and cannot use paid features. Contact support if you think that is wrong.';

async function _accountHold(env, subject, what) {
  if (!subject || !subject.blocked) return null;
  audit(env, 'spend_blocked_account', {
    email: subject.email || '', what, reason: subject.blockedReason || '' });
  return json({ error: ACCOUNT_HOLD_MESSAGE, code: 'account_blocked' }, 403);
}

/* One gate, so a spending path added later cannot quietly be outside the
   ceiling the way these two were. Returns a refusal to hand back, or null when
   the call may go ahead.

   The free tier is shed first, exactly as it is on chat: on a busy day the
   traffic that pays nothing is what stops, because turning away somebody who
   has paid is a refund, then a chargeback, then a review. */
/* AMV-004: this books the money it is about to allow, rather than reading a
   total and hoping nothing else arrives before the charge lands.

   `usd` is what this call will cost. Where the price is published and fixed the
   reservation is exact; where it is not - SMS reserves a full-length reply at
   the tier's rate before knowing what the turn will use - it is an upper bound,
   and the difference is settled afterwards.

   `out` is filled in with what was booked, per counter, so the caller MUST pass
   it to _recordSpend (which then applies only the difference) or to
   _releaseSpendGate if the work does not happen. A caller that passes neither
   gets the old read-only behaviour, which is still correct for a pure check -
   but for a caller that reserves, forgetting to settle leaves somebody's
   allowance holding money for work that already finished. */
async function _spendGate(env, user, what, usd, out, opts) {
  const held = await _accountHold(env, user, what);
  if (held) return held;
  const price = Math.max(0, +usd || 0);
  const book = out || {};
  book.account = 0; book.global = 0; book.accountName = ''; book.globalName = '';
  book.period = _periodKeyOf(user);
  /* THIS ACCOUNT'S OWN CEILING FIRST, because it is the one somebody set.

     The global cap protects AMV. It says nothing about whether THIS person -
     or the parent paying for them - agreed to this spend, and image and video
     were bounded only by a plan COUNT: so many images a day. A count is not a
     dollar limit. A parent who set $10 a month had a child who stopped at $10
     of chat and could then run the plan's full daily image allowance every
     day, plus video at fifty cents a call.

     Checked before the global ceiling because it refuses for a different
     reason and the person needs to hear the right one: "you have used the
     limit set for your account" is not "AMV is busy". */
  const ceilingInfo = _monthlyCeiling(user);
  /* A free account has no plan backstop, so _monthlyCeiling answers null and
     the account half of this gate does not run. For most paths that is right -
     the free tier is bounded by the token allowance and by the free share of
     the day's ceiling. A caller that has its own free-tier budget passes it
     here rather than checking separately, or routing through this gate would
     be a downgrade for exactly the accounts that pay nothing. */
  const fallback = opts && opts.fallbackCeilingUSD;
  const ceiling = ceilingInfo.value != null ? ceilingInfo.value
                : (typeof fallback === 'number' && fallback >= 0 ? fallback : null);
  if (ceiling != null) {
    const costName = `cost:${user.billingSubject || user.email}:${_periodKeyOf(user)}`;
    let capRes = null;
    /* Reserved, not read. The old `checkCap` here let every concurrent request
       see the same total and all pass; the account's monthly ceiling could be
       exceeded by as many videos as arrived at once, at half a dollar each. */
    try {
      capRes = await _reserveUSD(env, costName, price, ceiling, 86400000 * 70);
      if (capRes.allowed) { book.account = capRes.reserved; book.accountName = costName; }
    }
    catch (e) { audit(env, 'spend_gate_blind', { what, scope: 'account', error: String((e && e.message) || e) }); }
    if (capRes && !capRes.allowed) {
      /* AMV-005, the second half. This said "family" whenever a family cap
         EXISTED rather than when it was the one that bound - so a child on a
         paid plan whose parent had set a generous cap, who then used up the
         PLAN allowance, was told to ask their parent to raise a limit that was
         not the constraint. The advice was confidently wrong, which is worse
         than vague. The helper decides it once, from the numbers. */
      const hitFamily = ceilingInfo.source === 'family';
      audit(env, 'spend_cap_hit', { email: user.email, plan: user.plan, family: hitFamily, what });
      /* Both of these say "it resets" and neither said when, so the client had
         nothing to show and invented an hour. */
      const resetAt = _periodResetAtOf(user);
      return json(hitFamily
        ? { error: 'You have used the monthly limit set for your account. It resets next month, or whoever manages your family can raise it.',
            code: 'family_cap', resetAt }
        : { error: 'You\u2019ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.',
            code: 'quota_month', resetAt }, 429, { 'Retry-After': _retryAfterUntil(resetAt) });
    }
  }
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (!(gCap > 0)) return null;
  const paying = _planPriceUSD(user.plan, user.customCfg) > 0;
  const cap = paying ? gCap : +(gCap * FREE_TIER_CAP_SHARE).toFixed(2);
  /* Two ceilings, two reservations, and the second one failing has to give the
     first one back - otherwise being refused by the day's ceiling would still
     consume the customer's own monthly allowance for work that never ran. */
  const gName = `spend:${todayKey()}`;
  let res;
  try {
    res = await _reserveUSD(env, gName, price, cap, 86400000 * 2);
    if (res.allowed) { book.global = res.reserved; book.globalName = gName; }
  }
  catch (e) {
    /* FAILING OPEN IS THE RIGHT CALL. FAILING OPEN QUIETLY IS NOT.

       If the counter cannot be reached, refusing everybody turns one component
       being unhappy into a total outage, and that is worse. So the work goes
       ahead - but for as long as this is happening the daily ceiling does not
       exist, and it used to not exist in total silence: no audit line, no
       alert, nothing anywhere saying the one control that stops a runaway bill
       was switched off. An operator would find out from the invoice.

       Now it says so. The free tier is still shed first, because if the
       ceiling is blind the cheapest thing to do is stop giving compute away
       while nobody can count it - that keeps the unbounded window as small as
       it can be without turning a degraded counter into a refund. */
    audit(env, 'spend_gate_blind', { what, cap, paying, error: String((e && e.message) || e) });
    try {
      await alertOnce(env, 'spend_gate_blind',
        'The spend counter is unreachable, so the daily ceiling is not being enforced. Paid work is still running; free work is being refused until it recovers.', 30);
    } catch (_) {}
    if (!paying) {
      await _releaseSpendGate(env, book);
      return json({ error: 'AMV is at capacity for free accounts right now. Paid plans are running normally - please try again shortly.',
                    code: 'free_capacity' }, 503, { 'Retry-After': _retryAfterMidnight() });
    }
    return null;
  }
  if (res && res.allowed) return null;
  /* From here the day's ceiling refused, so whatever the account's own ceiling
     just booked is money for work that will not happen. */
  await _releaseSpendGate(env, book);
  if (!paying) {
    audit(env, 'free_cap_hit', { what, value: res && res.value, cap });
    return json({ error: 'AMV is at capacity for free accounts today - it resets tomorrow. Paid plans are running normally.',
                  code: 'free_capacity' }, 503, { 'Retry-After': _retryAfterMidnight() });
  }
  audit(env, 'global_cap_hit', { what, value: res && res.value, cap });
  try { await alertOnce(env, 'global_cap', 'The daily spend ceiling has been reached, so AMV is refusing paid work until tomorrow.', 60); } catch (e) {}
  return json({ error: 'Service is at capacity for today. Please try again tomorrow.', code: 'global_cap' }, 503,
              { 'Retry-After': _retryAfterMidnight() });
}

/* Give back everything a gate booked, for work that is not going to happen.
   Zeroes the record as it goes, so calling it twice cannot refund twice - a
   double release would credit the customer money they never spent, which is
   the same class of error as the double charge this all exists to prevent. */
async function _releaseSpendGate(env, book) {
  if (!book) return;
  if (book.account > 0 && book.accountName) {
    await _releaseUSD(env, book.accountName, book.account, 86400000 * 70);
  }
  if (book.global > 0 && book.globalName) {
    await _releaseUSD(env, book.globalName, book.global, 86400000 * 2);
  }
  book.account = 0; book.global = 0;
}

/* AMV-004: A DOLLAR CEILING THAT IS ONLY READ IS NOT A CEILING.

   Every dollar limit in AMV was enforced as `checkCap` (a read) followed, after
   the work, by `incr` (the charge). Those are two calls. The counter is a
   Durable Object so each one is atomic on its own, but the PAIR is not: twenty
   concurrent requests all read the same total, all decide they fit, and all
   proceed. The overshoot is bounded only by how many requests arrive at once.

   The token quota two blocks up already knew this - there is a comment there
   measuring an 8-request burst at 3.2x its cap - and it was fixed by reserving
   an upper bound atomically before the call and settling the difference after.
   The money ceilings were left on the racing version, which is the wrong way
   round: tokens are an allowance, dollars are the bill.

   So the same shape, for money. `_reserveUSD` books the most this call can
   cost before it runs; `_releaseUSD` gives it back if the work does not happen;
   and `_recordSpend` is told what was already booked so it applies only the
   difference instead of charging twice.

   Reserving an upper bound means somebody very close to their ceiling can be
   refused while a few cents remain. That is the correct direction for a control
   whose whole job is to stop a bill: being stopped one call early is a smaller
   harm than an unbounded overshoot, and it is what the token path already does. */
async function _reserveUSD(env, name, usd, cap, ttlMs, keep) {
  /* No ceiling means nothing to reserve against - the counter is still written
     afterwards, it just cannot refuse. */
  if (cap == null) return { allowed: true, value: 0, reserved: 0 };
  const amount = Math.max(0, +usd || 0);
  const r = await counter(env, name, keep ? { op: 'reserve', amount, cap, keep: true } : { op: 'reserve', amount, cap, ttlMs });
  return { allowed: !!(r && r.allowed), value: (r && r.value) || 0,
           reserved: (r && r.allowed) ? amount : 0 };
}
/* Hand back money booked for work that did not happen. Never throws: a refund
   that fails must not also fail the refusal it belongs to. */
async function _releaseUSD(env, name, usd, ttlMs, keep) {
  if (!(+usd > 0)) return;
  try { await counter(env, name, keep ? { op: 'incr', amount: -(+usd), keep: true } : { op: 'incr', amount: -(+usd), ttlMs }); }
  catch (e) { audit(env, 'spend_release_failed', { name, usd: +usd }); }
}

/* What it cost, recorded where the ceiling and the owner's screens read it.
   Best-effort on purpose: losing the accounting must not lose the work somebody
   already paid a provider for - but it is audited, so a counter that stops
   answering is visible rather than a bill that quietly stops being counted.

   `reserved` is what a pre-flight reservation already booked, per counter. The
   two CAPPED ledgers settle the difference; the two REPORTING ledgers
   (`costtotal`, `featcost`) are never reserved against and always take the full
   amount, or the owner's numbers would be short by whatever was pre-booked. */
async function _recordSpend(env, subject, usd, what, period, reserved) {
  const amount = +(+usd || 0);
  const preGlobal = Math.max(0, +((reserved && reserved.global) || 0));
  const preAccount = Math.max(0, +((reserved && reserved.account) || 0));
  if (!(amount > 0) && !(preGlobal > 0) && !(preAccount > 0)) return;
  try {
    const dGlobal = amount - preGlobal;
    if (dGlobal !== 0) await counter(env, `spend:${todayKey()}`, { op: 'incr', amount: dGlobal, ttlMs: 86400000 * 2 });
    /* The customer's own window, which is their billing period rather than the
       calendar month - see _periodKeyFor. The platform totals below stay on the
       calendar, because those are the owner's reporting and a month is what a
       month means there. */
    const dAccount = amount - preAccount;
    if (dAccount !== 0) await counter(env, `cost:${subject}:${period || monthKey()}`, { op: 'incr', amount: dAccount, ttlMs: 86400000 * 70 });
    /* AND the platform total, which is the one the owner actually reads.

       Chat books all three of these. Image and video generation, when they
       existed, booked the first two: they reached the daily ceiling and the
       per-account cost and never reached costtotal - the number the founder
       dashboard reports as the month's cost, and the number every margin on
       that screen is derived from. Video was the dearest call in the product
       at half a dollar a go, and it was the one missing from the profit
       figure.

       Both features are gone now, and the rule they taught is why this line
       stays where it is rather than at each call site: a ceiling that is too
       low announces itself, a cost that is too low does not. Anything that
       spends books all three here, or it will be invisible in exactly the
       place somebody is reading to decide whether AMV makes money. */
    await counter(env, `costtotal:${monthKey()}`, { op: 'incr', amount, ttlMs: 86400000 * 70 });
    await counter(env, `featcost:${what || 'other'}:${monthKey()}`, { op: 'incr', amount, ttlMs: 86400000 * 70 });
  } catch (e) {
    audit(env, 'spend_not_recorded', { what, subject, usd: amount, error: String((e && e.message) || e) });
  }
}


/* A WRITE THAT MOVES MONEY OR PERMISSION FAILED, AND MUST NOT DO SO QUIETLY.

   Best-effort is right for a statistic and wrong for a ledger: a refund that
   did not land leaves somebody charged for nothing, a spend that was not
   recorded lets them pass a limit they set, a revocation that did not happen
   leaves old sessions open. These still do not fail the request around them -
   the person's answer is not held hostage to bookkeeping - but each is
   recorded and the operator told, so it can be put right. The gate's
   "no money or permission write swallowed silently" stage keeps it that way. */
async function _writeFailed(env, where, e) {
  try { audit(env, 'write_failed', { where, error: String((e && e.message) || e).slice(0, 160) }); } catch (_) {}
  try { await alertOnce(env, 'write_failed_' + where, 'A money or permission write failed (' + where + '): ' + String((e && e.message) || e).slice(0, 160), 60); } catch (_) {}
}
