    return json({ error: 'An assistant must include its instructions - what it is for and how it answers, at least a couple of sentences.', code: 'empty_assistant' }, 400);
  }
  /* What makes it an assistant beyond its text: starter questions and an
     engine. Bounded and plain - starters are shown as text, and the engine is
     only ever a name the buyer's own plan is checked against. */
  const assistant = kind === 'agent' && item.assistant && typeof item.assistant === 'object' ? {
    starters: (Array.isArray(item.assistant.starters) ? item.assistant.starters : []).slice(0, 4)
      .map(x => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140)).filter(Boolean),
    engine: /^[a-z][a-z0-9-]{0,31}$/.test(String(item.assistant.engine || '')) ? String(item.assistant.engine) : '',
  } : undefined;
  const clean = {
    id: 'usr_' + crypto.randomUUID().replace(/-/g,''),
    kind, title,
    cat: String(item.cat || 'Community').slice(0, 40),
    desc: String(item.desc || '').slice(0, 280),
    text: body,
    crew: Array.isArray(item.crew) ? item.crew.slice(0, 8) : undefined,
    assistant,
    plugin: pluginClean ? pluginClean.plugin : undefined,
    files,
    // icon is rendered unescaped on the client, so store an emoji/short-text
    // only - reject any markup outright (never a truncated tag fragment).
    icon: (function(ic){ ic = String(ic == null ? '\u2728' : ic); return ic.indexOf('<') >= 0 ? '\u2728' : (ic.slice(0, 8) || '\u2728'); })(),
    price,
    author: (user.name || user.email.split('@')[0]).slice(0, 40),
    authorEmail: user.email,
    installs: 0,
    sales: 0,
    views: 0,
    status: screen.action === 'held_for_review' ? 'under_review' : 'active',
    review: screen.action === 'held_for_review' ? { signals: screen.signals || [], at: Date.now() } : undefined,
    createdAt: Date.now(),
  };
  await env.AMV_KV.put(`market:${clean.id}`, JSON.stringify(clean));
  await _sellerIndexAdd(env, user.email, clean.id);
  await _marketCacheBust(env);
  if (screen.action === 'held_for_review') {
    audit(env, 'market_held_for_review', { id: clean.id, by: user.email, signals: screen.signals });
  }
  audit(env, 'market_publish', { id: clean.id, by: user.email, price, files: files.length, status: clean.status });
  return json({ ok: true, item: _publicListing(clean), review: screen.action === 'held_for_review' ? screen.reason : undefined });
}

/* Strip the deliverable (text/crew/file DATA) from a paid listing so it can't
   be read for free from the public catalog. File NAMES stay as a teaser.
   Free items keep their content inline. */
function _publicListing(it) {
  if (!it.price || it.price <= 0) return it;
  const { text, crew, files, plugin, ...rest } = it;
  const teaser = Array.isArray(files) ? files.map(f => ({ name: f.name, type: f.type, size: f.size })) : [];
  return { ...rest, files: teaser, locked: true };
}

async function marketInstall(request, env) {
  /* AMV-096: installs drive ranking, so an install has to cost something. It
     used to be unauthenticated and limited only per IP, which means a rented
     address pool could rank anything to the top of the marketplace. Now it
     takes an account, and counts ONCE per account per listing - a number that
     can be manufactured is not a ranking signal, it is an advertisement. */
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to install' }, 401);
  const iip = _rlIp(request);
  const irl = await limitAction(env, `mktinstall:${iip}`, 30, 300);
  if (!irl.ok) return json({ ok: true, throttled: true });
  const { id } = await request.json().catch(() => ({}));
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return json({ error: 'bad id' }, 400);
  // Second and later installs by the same account are honoured, but not counted.
  const first = await _claimOnce(env, 'mktinst', `${user.email}:${id}`, CLAIM_ONCE_TTL_S);
  if (!first) return json({ ok: true, counted: false });
  const raw = await env.AMV_KV.get(`market:${id}`);
  if (raw) {
    try {
      JSON.parse(raw);                       // still a listing, not a stray key
      await _withKV(env, 'market', id, (rec) => {
        if (rec) rec.installs = (rec.installs || 0) + 1;
      });
    } catch {}
  }
  return json({ ok: true, counted: true });
}

/* =====================================================================
   MARKETPLACE ECONOMY - paid listings, 80/20 split, seller balance.
   ---------------------------------------------------------------------
   Money flow: buyer pays the full price through the SAME Stripe checkout
   used for plans (mode=payment, one-time). On checkout.session.completed
   the webhook calls _creditSale(): the buyer is granted the item, the
   seller's balance is credited 80%, the platform keeps 20%. Sellers see
   their balance and can request a withdrawal (extraction) of it.
   Records:
     purchases:<buyer>      -> [ {id, title, kind, price, ts} ]   (what they own)
     entitleitem:<buyer>:<id> -> '1'                              (fast ownership check)
     wallet:<seller>        -> { balance, lifetime, currency }    (earnings ledger)
     wallet_tx:<seller>     -> [ {type, amount, item, ts, ...} ]  (ledger history)
     withdraw:<id>          -> { seller, amount, status, ts }     (extraction requests)
   ===================================================================== */
const MARKET_PLATFORM_FEE = 0.20;   // you keep 20%, seller gets 80%
const MARKET_MIN_WITHDRAW = 10;     // minimum balance (USD) to extract

async function _getListing(env, id) {
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return null;
  const raw = await env.AMV_KV.get(`market:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/* ONE SELLER'S LISTINGS, WITHOUT READING EVERYBODY'S.

   marketMyListings walked every `market:` key in the product and did a full
   read of each one, keeping the handful whose authorEmail matched. With four
   listings that is four reads. With four hundred thousand it is four hundred
   thousand reads, on a page one seller opened to see their own three items -
   and it had no cap at all, so it did not stop, it just got slower and more
   expensive every time anybody else published anything.

   An index is the whole fix: the author of a listing never changes, so the
   membership is decided once at publish and once at removal.

   BUILT ON FIRST USE rather than migrated. `built` is what separates "this
   seller has no listings" from "nobody has ever asked", so an empty index is
   not rebuilt on every page load - which is the bug this exists to fix,
   rewritten as a cache miss. */
const MKT_SCAN_MAX = 20000;      // keys, not results: a bound has to bound the work
/* AND A BOUND ON THE INDEX ITSELF.

   These indexes were added to stop three pages reading the whole store, and
   they went in without a cap - which trades an unbounded READ for an unbounded
   WRITE, and the write is the worse one. Both records are written on every
   publish and every message, and KV has a hard ceiling on a value: past it
   every write fails, so the person stops being able to publish or send
   anything at all. The read they replaced was only slow.

   Most recent last, capped. An inbox that holds your most recent few thousand
   conversations is how every inbox works, and this bounds the INDEX, not the
   data - every listing and every message is still exactly where it was. */
const MKT_INDEX_MAX = 4000;

async function _sellerListingIds(env, email) {
  const em = String(email || '').toLowerCase();
  if (!em) return { ids: [], built: 0, scanned: 0, truncated: false };
  try {
    const raw = await env.AMV_KV.get(`mktmine:${em}`);
    if (raw) {
      const r = JSON.parse(raw);
      if (r && r.built) return { ids: Array.isArray(r.ids) ? r.ids : [], built: r.built, scanned: 0, truncated: false };
    }
  } catch (e) { /* unreadable index: rebuild it below rather than fail the page */ }

  /* The old behaviour, ONCE, to seed the index for listings that predate it. */
  const ids = [];
  let cursor, scanned = 0, truncated = false;
  do {
    const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
    for (const k of (page.keys || [])) {
      scanned++;
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { const it = JSON.parse(raw); if (it && it.authorEmail === em) ids.push(it.id || k.name.slice(7)); } catch (e) {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
    if (cursor && scanned >= MKT_SCAN_MAX) { truncated = true; break; }
  } while (cursor);

  /* A backfill that stopped short must NOT be written as if it were complete -
     the seller would lose the listings past the cap permanently, which is
     worse than the slow page it replaces. */
  if (!truncated) {
    try { await env.AMV_KV.put(`mktmine:${em}`, JSON.stringify({ ids: ids.slice(-MKT_INDEX_MAX), built: Date.now() })); } catch (e) {}
  } else {
    audit(env, 'seller_index_partial', { email: em, scanned });
  }
  return { ids, built: 0, scanned, truncated };
}

/* Keep it true. Called where a listing is created and where it is removed -
   the only two moments its author changes. */
async function _sellerIndexAdd(env, email, id) {
  const em = String(email || '').toLowerCase();
  if (!em || !id) return;
  try {
    await _withKV(env, 'mktmine', em, (r) => {
      r.ids = Array.isArray(r.ids) ? r.ids : [];
      if (!r.ids.includes(id)) r.ids.push(id);
      if (r.ids.length > MKT_INDEX_MAX) r.ids = r.ids.slice(-MKT_INDEX_MAX);
      /* Marked built either way: an index that gains a listing is an index,
         and leaving `built` unset would send the next read back to the scan. */
      r.built = r.built || Date.now();
      return r;
    }, { ids: [], built: 0 });
  } catch (e) { audit(env, 'seller_index_add_failed', { email: em, id, error: String((e && e.message) || e) }); }
}
async function _sellerIndexRemove(env, email, id) {
  const em = String(email || '').toLowerCase();
  if (!em || !id) return;
  try {
    await _withKV(env, 'mktmine', em, (r) => {
      r.ids = (Array.isArray(r.ids) ? r.ids : []).filter(x => x !== id);
      r.built = r.built || Date.now();
      return r;
    }, { ids: [], built: 0 });
  } catch (e) { audit(env, 'seller_index_remove_failed', { email: em, id, error: String((e && e.message) || e) }); }
}
/* AMV-187: MONEY FROM A SALE CLEARS BEFORE IT CAN LEAVE.

   A card dispute arrives weeks after the charge. `_reverseSale` already handles
   that correctly on the books - it takes the item back, debits the seller, and
   lets the balance go NEGATIVE so nobody profits by being quick. It only works
   if the money is still here.

   Withdrawal paid out the whole balance the moment it passed the minimum, with
   no requirement that the funds had aged at all. So: list at $999, buy it from
   a second account with a stolen card, take the $799 the same minute, abandon
   the account. Six weeks later the dispute lands, the balance goes to -$799,
   and that is a number in a record nobody will ever return to. AMV is out the
   payout, the dispute fee, and a mark against its merchant account.

   So each credit is HELD until the window has substantially passed. Held money
   is still theirs - it is on the balance, it is shown, it is counted - it just
   cannot leave yet. A reversal takes the held money first, because that is the
   money most likely to still exist.

   Additive on purpose: a wallet written before this has no `holds` array, and
   an absent hold means cleared. Freezing every existing seller's balance on the
   day this ships would cost real sellers to stop a fraud that has not happened. */
const PAYOUT_HOLD_DAYS = 14;
const PAYOUT_HOLD_MS = PAYOUT_HOLD_DAYS * 86400000;

/* AN UNREADABLE WALLET IS NOT AN EMPTY WALLET.

   This used to be `try { return JSON.parse(raw) } catch {}` falling through to
   a fresh zero wallet, and that made a corrupt record indistinguishable from a
   seller who has never sold anything. Two consequences, and the second is the
   one that cannot be undone.

   The screen showed $0.00 available, $0.00 lifetime and "No earnings yet -
   sell something to start" to somebody who is owed money. The code six lines
   from the caller says "Never a fabricated zero" about the network-failure
   path; this path fabricated exactly that zero.

   And `_withWallet` - the lock every money path goes through - reads with this
   function, mutates, and writes back with `_saveWallet`. So the next sale
   credit landing on a corrupt record did not fail: it overwrote the real
   balance, the lifetime total and the holds array with a fresh wallet plus the
   new sale. The seller's money was gone, permanently, and nothing anywhere
   said so.

   `_withKV` - which every other locked record uses - has always refused this:
   "Nothing is known about this record, so nothing may be written over it." The
   money one was the one that did not. Absent is still a new seller and still
   returns a fresh wallet; only present-and-unparseable throws. */
async function _wallet(env, email) {
  const raw = await env.AMV_KV.get(`wallet:${email}`);
  if (raw != null) {
    try { return JSON.parse(raw); }
    catch (e) {
      try { audit(env, 'record_corrupt', { key: `wallet:${email}`, bytes: String(raw).length }); } catch (_) {}
      throw new UnreadableRecordError(`wallet:${email}`, 'invalid JSON');
    }
  }
  return { balance: 0, lifetime: 0, currency: 'usd', holds: [] };
}
async function _saveWallet(env, email, w) { await env.AMV_KV.put(`wallet:${email}`, JSON.stringify(w)); }

/* AMV-190: EVERY WALLET MUTATION GOES THROUGH HERE.

   Withdrawal already serialized itself, because two withdrawals racing was
   obviously money. Crediting a sale and reversing one did read-modify-write on
   the SAME record with no lock at all, which is the same race wearing a
   different hat:

     two sales completing together - both read balance B, both write B+share,
     and one seller credit is silently gone. The seller notices; AMV cannot
     explain it, because nothing failed.

     a sale landing during a withdrawal - the payout zeroes what left, the sale
     writes the balance it read before that, and money already paid out is back
     on the books to be withdrawn a second time.

   Neither shows up until there is enough traffic for two things to happen at
   once, which is to say: until it is working.

   Short lock, real release, and a few retries - a webhook that cannot get the
   lock must NOT give up, because giving up means somebody paid and nobody was
   credited. If it truly cannot, it throws, and the caller's retry or the
   reconciliation sweep picks it up rather than the money quietly vanishing. */
const WALLET_LOCK_TRIES = 6;

/* AMV-196: READ, CHANGE, WRITE - WITHOUT LOSING THE OTHER WRITER.

   The wallet was the first record found doing this unguarded, and it is not the
   only one that matters. Two of the others cost more than money:

     `acct` - authLogin rewrites the password hash when it upgrades the
     iteration count, and authResetConfirm writes the NEW hash. A login with the
     OLD password in flight when a reset lands writes back the record it read
     BEFORE the reset, restoring the old hash and salt. The reset reports
     success, the new password does not work, and the old one still does -
     which is precisely the situation somebody resets their password to escape.

     `ent` - thirteen callers of setEntitlement plus three direct writers. A
     Stripe grant racing a referral bonus loses one of them, and the one that
     loses can be the plan somebody just paid for.

   `mutate` receives the CURRENT record, read inside the lock. Return a value to
   pass it back out. Failing to take the lock throws rather than writing
   anyway - a lost entitlement or a reverted password must not happen quietly. */
async function _withRecord(env, kind, id, load, save, mutate) {
  /* The key is used AS GIVEN. It used to be lowercased here, which is right for
     an email and silently wrong for a record id: a team id that is not already
     lowercase becomes a key that does not exist, `load` returns nothing, the
     mutate does nothing, and the caller is told the change was applied. The
     callers that key by email lowercase it themselves, where it is obviously an
     email. */
  const key = String(id || '');
  if (!key) return null;
  for (let i = 0; i < WALLET_LOCK_TRIES; i++) {
    if (await _claimOnce(env, 'rmut:' + kind, key, 15)) {
      try {
        const rec = await load(env, key);
        const out = await mutate(rec);
        await save(env, key, rec);
        return out;
      } finally { await _releaseClaim(env, 'rmut:' + kind, key); }
    }
    await new Promise(r => setTimeout(r, 40 * (i + 1)));
  }
  /* Tagged, because callers turn THIS into "try again" for the person. An
     ordinary bug inside the mutate must not wear the same badge: a caller that
     catches everything would answer "the record was busy" for ever while the
     real fault never surfaced. */
  audit(env, 'record_lock_timeout', { kind, id: key });
  try { await alertOnce(env, 'record_lock:' + kind,
    'A ' + kind + ' record could not be locked to apply a change, so the change was NOT made. '
    + 'If this is `ent` somebody may be on the wrong plan; if it is `acct` a password change may not have taken.', 30); } catch (e) {}
  const busy = new Error(kind + ' is busy');
  busy.code = 'record_busy';
  throw busy;
}
/* True only for "the lock could not be taken". Anything else thrown out of a
   mutate is a fault, and telling somebody to try again would hide it. */
const _isBusy = (e) => !!(e && e.code === 'record_busy');

async function _withWallet(env, email, mutate) {
  const em = String(email || '').toLowerCase();
  if (!em) return null;
  let lastErr = null;
  for (let i = 0; i < WALLET_LOCK_TRIES; i++) {
    if (await _claimOnce(env, 'wmut', em, 15)) {
      try {
        const w = await _wallet(env, em);
        const out = await mutate(w);
        await _saveWallet(env, em, w);
        return out;
      } catch (e) { lastErr = e; throw e; }
      finally { await _releaseClaim(env, 'wmut', em); }
    }
    await new Promise(r => setTimeout(r, 40 * (i + 1)));
  }
  /* Loud. A credit that cannot be applied is somebody's money, and the one
     thing that must not happen is for it to disappear quietly. */
  audit(env, 'wallet_lock_timeout', { email: em });
  try { await alertOnce(env, 'wallet_lock', 'A wallet could not be locked to apply a change - a sale credit or reversal may not have been recorded. Check the reconciliation sweep.', 30); } catch (e) {}
  throw lastErr || new Error('wallet is busy');
}

/* The two records where a lost write is worse than money. */
const _loadAcct = async (env, em) => (await DB.get(env, 'acct', em)) || null;
const _saveAcct = async (env, em, a) => { if (a) await DB.put(env, 'acct', em, a); };
async function _withAcct(env, email, mutate) {
  return _withRecord(env, 'acct', String(email || '').toLowerCase(), _loadAcct, _saveAcct, mutate);
}

/* AMV-197: THE RECORDS A GROUP OF PEOPLE ALL WRITE TO.

   `acct` and `ent` belong to one person, so a lost write there needs two of
   their own devices. A team record and a family record are written by everybody
   in them, from different places, at the same time - joining, leaving, being
   removed, changing a role, sharing something. Read-append-write on those does
   not need a coincidence; it needs two people using the product.

   What a lost write costs here is not an edit. It is a seat somebody paid for
   and did not get, a member who was removed and can still see everything, or a
   role change that silently did not happen. None of it errors, and the screen
   shows whichever version won.

   The mutate callback receives the record as it is INSIDE the lock, so a
   permission or capacity check written there is checked against what is true
   now rather than what was true when the request started. Returning
   `{ error, status, code }` refuses without writing; returning anything else
   commits. */
const _loadTeam = async (env, id) => (await DB.get(env, 'team', id)) || null;
const _saveTeam = async (env, id, t) => { if (t) await DB.put(env, 'team', id, t); };
async function _withTeam(env, id, mutate) {
  return _withRecord(env, 'team', id, _loadTeam, _saveTeam, mutate);
}
const _loadFam = async (env, id) => (await DB.get(env, 'fam', id)) || null;
const _saveFam = async (env, id, f) => { if (f) await DB.put(env, 'fam', id, f); };
/* AMV-203: the same lock for any record that is read, changed and written back.

   Nine of the ten defects found in the sweep after AMV-202 were this one shape
   on nine different record kinds, so the helper is generic rather than one per
   kind. `empty` is what a missing record starts as, and it is COPIED per call -
   a shared default object would be mutated by the first caller and handed to
   every one after it. */
async function _withKind(env, kind, id, mutate, empty) {
  return _withRecord(env, kind, String(id || ''),
    async (e, k) => (await DB.get(e, kind, k)) || (empty === undefined ? null : JSON.parse(JSON.stringify(empty))),
    async (e, k, rec) => { if (rec) await DB.put(e, kind, k, rec); },
    mutate);
}
/* And for the records that live under a raw KV key rather than a DB kind. */
/* AMV-012: "NOT THERE" AND "COULD NOT BE READ" ARE DIFFERENT ANSWERS.

   This caught every exception from the read - a transient storage error, a
   timeout, corrupt JSON - and returned the caller's `empty` value, which the
   mutate then filled in and the save wrote back over the key. A storage blip
   during a wallet or entitlement mutation therefore replaced a live record
   with a fresh empty one, silently, and the operation reported success.

   The lock made this worse rather than better: the write happens inside the
   lock, so it looks correct and nothing races it. It was the read that lied.

   Availability and absence are now separate outcomes. A genuine miss still
   yields `empty`, because a record that has never existed is a real state.
   Anything else throws, and the caller fails rather than overwriting data it
   could not see. Corrupt JSON throws too, and says which key, because a record
   that cannot be parsed is a record to look at rather than one to replace. */
class UnreadableRecordError extends Error {
  constructor(key, cause) {
    super('record could not be read: ' + key + (cause ? ' (' + cause + ')' : ''));
    this.name = 'UnreadableRecordError';
    this.key = key;
    this.kind = 'unreadable';
  }
}

async function _withKV(env, name, key, mutate, empty) {
  const fresh = () => (empty === undefined ? null : JSON.parse(JSON.stringify(empty)));
  return _withRecord(env, name, String(key || ''),
    async (e, k) => {
      const id = `${name}:${k}`;
      let raw;
      try {
        raw = await e.AMV_KV.get(id);
      } catch (err) {
        /* The store was unreachable. Nothing is known about this record, so
           nothing may be written over it. */
        throw new UnreadableRecordError(id, String((err && err.message) || err));
      }
      if (raw == null) return fresh();          // genuinely absent
      try {
        return JSON.parse(raw);
      } catch (err) {
        try { audit(env, 'record_corrupt', { key: id, bytes: String(raw).length }); } catch (_) {}
        throw new UnreadableRecordError(id, 'invalid JSON');
      }
    },
    async (e, k, rec) => { if (rec) await e.AMV_KV.put(`${name}:${k}`, JSON.stringify(rec)); },
    mutate);
}

/* AMV-202: A LOCK ONLY HOLDS IF EVERY WRITER TAKES IT.

   setEntitlement has run under the ent record lock since AMV-196, which stops
   two grants losing each other. It does nothing about the eleven other places
   that wrote this record directly and took no lock at all - and a locked writer
   is no safer than the unlocked one racing it.

   The sharp one is a past-due mark landing beside a payment: the customer pays,
   the grant is applied under the lock, and the unlocked past-due write puts
   back the record it read first. A paying customer is marked past due and loses
   what they just bought, and nothing anywhere fails.

   Keyed by address, so lowercasing belongs here where the value is obviously an
   address. Whatever `load` returned is written back, so a mutate that decides
   there is nothing to do rewrites the record it just read inside the lock -
   which is a no-op, not a lost write. */
const _loadEnt = async (env, em) => (await DB.get(env, 'ent', em)) || null;
const _saveEnt = async (env, em, e) => { if (e) await DB.put(env, 'ent', em, e); };
async function _withEnt(env, email, mutate) {
  return _withRecord(env, 'ent', String(email || '').toLowerCase(), _loadEnt, _saveEnt, mutate);
}
async function _withFam(env, id, mutate) {
  // Keyed by the parent's address, so lowercasing is right here and stated here.
  return _withRecord(env, 'fam', String(id || '').toLowerCase(), _loadFam, _saveFam, mutate);
}
/* One shape for "the lock said no" so every caller answers the same way, and
   nobody is told a change happened that did not. */
function _busyJson(what) {
  return json({ error: 'Your ' + what + ' was being changed by somebody else just then, so this was not applied. Please try again.',
                code: 'record_busy' }, 503);
}

/* What this seller could actually withdraw right now: the balance, less
   everything still inside its clearing window. Never below zero on the
   available side - a negative balance from a reversal is a debt to work off,
   not a number to withdraw against. */
async function _availableBalance(env, email, now = Date.now()) {
  const w = await _wallet(env, email);
  return _availableOf(w, now);
}
function _availableOf(w, now = Date.now()) {
  /* Only holds that have NOT matured hold anything back. Subtracting every hold
     regardless of age was the first version and it never cleared at all - money
     would have been frozen for ever, which is a worse failure than the one this
     exists to prevent. */
  const held = (w.holds || [])
    .filter(h => (+h.until || 0) > now)
    .reduce((n, h) => n + (+h.amount || 0), 0);
  return +Math.max(0, (+w.balance || 0) - held).toFixed(2);
}
/* Holds whose window has passed have done their job; once the money they were
   holding has actually left, they are noise that makes the record harder to
   read and the arithmetic easier to get wrong. */
function _pruneMaturedHolds(w, now = Date.now()) {
  w.holds = (w.holds || []).filter(h => (+h.until || 0) > now);
  return w;
}
/* When the next tranche frees up, so a refusal can say WHEN rather than no. */
function _nextClearingAt(w) {
  const now = Date.now();
  const times = (w.holds || []).map(h => +h.until || 0)
    .filter(t => t > now).sort((a, b) => a - b);
  return times.length ? times[0] : 0;
}
/* Same rule as `_wallet` above, for the same reason: a money history that
   cannot be read is not a money history with nothing in it. This one is also
   read-modify-written by `_pushWalletTx`, so swallowing the parse here would
   let the next sale replace a seller's whole record of what they were paid
   with a single line. */
async function _walletTx(env, email) {
  const raw = await env.AMV_KV.get(`wallet_tx:${email}`);
  if (raw != null) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      try { audit(env, 'record_corrupt', { key: `wallet_tx:${email}`, bytes: String(raw).length }); } catch (_) {}
      throw new UnreadableRecordError(`wallet_tx:${email}`, 'invalid JSON');
    }
  }
  return [];
}
/* Append a line to somebody's money history, at most once per event.

   A sale that fails partway is retried, and the retry re-runs the steps that
   already succeeded - so an append has to be able to tell whether it is the
   same event coming round again. `ref` (the charge) and `item` together are
   that identity, and a caller supplying both gets exactly-once for free.

   Returns whether it actually wrote, so a caller can tell "recorded now" from
   "was already recorded" - which is what the steps after it key on. A caller
   with no ref gets the old behaviour: always append. */
/* UNDER THE LOCK, BECAUSE FIVE MONEY PATHS WRITE THIS AND NONE OF THEM WAITED.

   This was a read, an unshift and a put - a read-modify-write with nothing
   serialising it - and it is called from every path that moves a seller's
   money: the sale credit, the reversal, the withdrawal, and both payout
   settlements. A sale landing beside a withdrawal simply lost one of the two
   lines, and this record is what a seller reads to understand what happened to
   their money and what an operator reads in a dispute.

   The single-writer shape is what hid it. Every other record here has several
   handlers writing it, which is visible; this has ONE function with five
   callers, which reads as safe and is not. And it is why the lock sweep is
   silent: `wallet_tx` had no locked writer anywhere, so the rule it enforces -
   locked somewhere, therefore locked everywhere - never engaged. Going through
   the shared helper is what puts it inside that rule, so the next writer is
   held to it.

   It also stopped being merely a log. The dedupe below is what tells a retried
   sale that its history line already exists, so a lost line does not just
   leave a gap now - it lets the next attempt write a second one.

   `_withKV` writes `wallet_tx:<key>`, which is the same key this always used,
   and the key is passed through exactly as callers give it - lowercasing here
   and not in `_walletTx` would split reads from writes. */
async function _pushWalletTx(env, email, tx) {
  return await _withKV(env, 'wallet_tx', email, (list) => {
    if (tx && tx.ref && tx.item &&
        list.some((t) => t && t.ref === tx.ref && t.item === tx.item && t.type === tx.type)) {
      return false;
    }
    /* In place: the helper writes back the object it loaded, so building a new
       array here would be a no-op that looked like a write. */
    list.unshift(tx);
    if (list.length > 500) list.length = 500;
    return true;
  }, []);
}
async function _ownsItem(env, email, id) {
  return !!(await env.AMV_KV.get(`entitleitem:${email}:${id}`));
}

/* Start a purchase: creates a one-time Stripe Checkout for a paid listing.
   We pass the item id + buyer in metadata so the webhook can grant + split. */
async function marketBuy(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to buy' }, 401);
  /* Money out of a card. A minor cannot form a binding contract, which is
     exactly why their purchases come back as chargebacks. */
  const ageBad = await _moneyAgeGate(env, user.email);
  if (ageBad) return json(ageBad, ageBad.code === 'age_required' ? 428 : 403);
  /* A purchase creates a Stripe session too, so it carries the same bound as
     the plan checkout for the same reason. */
  const bg = await guardAction(env, `mktbuy:${user.email}`, 10, 100, 'purchases');
  if (bg) return bg;
  const { id } = await request.json().catch(() => ({}));
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'item not found' }, 404);
  if (/^usr_/.test(id) && it.status === 'sold') return json({ error: 'Sorry - this just sold. Message the seller to ask for another.' }, 409);

  if (!it.price || it.price <= 0) return json({ error: 'this item is free - just install it' }, 400);
  if (it.authorEmail === user.email) return json({ error: 'you cannot buy your own listing' }, 400);
  if (await _ownsItem(env, user.email, id)) return json({ error: 'you already own this', owned: true }, 400);
  /* A parent switching off marketplace purchases has to mean it at the point
     money would move, not in a settings screen nobody consults (AMV-102). */
  if (user.family && user.family.limits && !user.family.limits.marketplace) {
    return json({ error: 'Buying from the marketplace is turned off for your account. Whoever manages your family can turn it on.',
                  code: 'family_blocked' }, 403);
  }
  /* Same fact, same words as the subscription routes. Somebody pressing Buy
     on a marketplace listing is owed a sentence, not a config note. */
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'Payments are not connected on this deployment yet, so this cannot be bought. Nothing has been charged.',
                  code: 'needs_service' }, 503);

  /* AMV-009: THE CHECKOUT THEY ALREADY HAVE, IF THERE IS ONE.

     Every call here used to create a fresh payment session. Two clicks on a
     slow connection, a double submit, or a back button and a retry produced two
     live sessions for the same item, and both of them take a card.

     The credit is exactly-once per buyer and item, so the SECOND payment grants
     nothing - which is worse than granting twice. The buyer is charged for a
     thing they already own and nothing anywhere notices, because from the
     inside the duplicate credit was correctly refused. The safety mechanism is
     what makes the loss silent.

     Returned before a second session is created, which is the only point at
     which a duplicate charge can still be prevented. Reached only after the
     already-owns check above, so somebody who has finished paying is told they
     own it rather than handed a stale checkout. */
  try {
    const open = JSON.parse(await env.AMV_KV.get(`mktsess:${user.email}:${id}`) || 'null');
    if (open && open.url && open.id) {
      audit(env, 'market_checkout_reused', { buyer: user.email, item: id, session: open.id });
      return json({ ok: true, url: open.url, id: open.id, reused: true });
    }
  } catch (e) { /* a missing or unreadable note just means a new session */ }

  /* AMV-009: A ONE-OF-A-KIND LISTING IS RESERVED, NOT MERELY CHECKED.

     The 'sold' test near the top of this function is a read followed by a
     decision. Two buyers arriving together both read a status that has not
     changed yet, both are sent to checkout, and both pay. One gets the item;
     the other has paid for something that no longer exists, and finds out by
     not receiving it - which is the worst way for somebody to learn they were
     charged.

     Claimed through the Durable Object rather than written to storage after a
     read, because a read-then-write reservation is the same race with an extra
     step. It expires by itself, so an abandoned checkout does not take an item
     off the market for a day.

     Taken HERE, after the buyer's own open session has been handed back above,
     so returning to your own checkout can never be blocked by your own hold. */
  if (/^usr_/.test(id)) {
    if (!(await _claimOnce(env, 'mktresv', id, MARKET_RESERVE_S))) {
      return json({ error: 'Somebody else is buying this right now. Try again in a few minutes, or message the seller.',
                    code: 'item_reserved' }, 409);
    }
  }

  // AMV-025 / AMV-SP-09: the server-configured origin is authoritative for
  // payment redirects, and there is no fallback to the request Origin.
  const origin = _paymentReturnOrigin(env);
  if (!origin) return _paymentOriginMissing();
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  /* The same for a marketplace purchase, where the single-use methods matter
     most: PIX, OXXO, BLIK and iDEAL are all one-off payments and all of them
     are how their countries actually buy something once. */
  form.set('automatic_payment_methods[enabled]', 'true');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', ('AMV: ' + it.title).slice(0, 120));
  form.set('line_items[0][price_data][unit_amount]', String(it.price * 100));
  form.set('line_items[0][quantity]', '1');
  form.set('customer_email', user.email);
  form.set('client_reference_id', user.email);
  form.set('success_url', `${origin}?bought=${encodeURIComponent(id)}`);
  form.set('cancel_url', `${origin}?canceled=1`);
  form.set('metadata[kind]', 'market_purchase');
  form.set('metadata[itemId]', id);
  form.set('metadata[buyer]', user.email);
  form.set('metadata[seller]', it.authorEmail || '');

  const r = await fetchDeadline('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) {
    /* No checkout exists, so nothing is being paid for and the item goes back
       on the market now rather than when the hold expires. */
    if (/^usr_/.test(id)) { try { await _releaseClaim(env, 'mktresv', id); } catch (e) {} }
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  /* Remembered until the webhook completes it. If that delivery never
     lands, the sweep asks Stripe directly rather than leaving somebody
     who paid with nothing. */
  await _pendStart(env, d.id, { provider:'stripe', kind:'market', email:user.email,
                                itemId:id, seller:(it.authorEmail||'').toLowerCase() });
  /* AMV-009: ONE OPEN CHECKOUT PER BUYER PER ITEM.

     Every call to this route created a fresh Stripe session. Two clicks on a
     slow connection, a double-submit, or a back button and a retry produced two
     live sessions for the same item - and both of them take a card.

     The credit is exactly-once per (buyer, item), so the SECOND payment grants
     nothing. That is worse than granting twice: the buyer is charged for a
     thing they already own and nothing anywhere notices, because from AMV's
     side the duplicate credit was correctly refused.

     So the session is remembered and handed back. A buyer who returns to the
     checkout gets the one they already have rather than a second card charge.
     It expires with Stripe's own session window, so an abandoned checkout does
     not lock somebody out of buying. */
  await env.AMV_KV.put(`mktsess:${user.email}:${id}`, JSON.stringify({ id: d.id, url: d.url, at: Date.now() }),
                       { expirationTtl: MARKET_SESSION_TTL_S });

  return json({ ok: true, url: d.url, id: d.id });
}

/* Called from the Stripe webhook when a market_purchase session completes.
   Grants the item to the buyer and credits the seller their 80% share. */
async function _creditSale(env, { itemId, buyer, seller, amountCents, ref }) {
  if (!itemId || !buyer) return;
  // Exactly-once: atomically claim this (buyer,item) sale. A buyer can never own
  // the same item twice (marketBuy blocks re-purchase), so this is a stable key.
  // The claim is atomic on D1, closing the double-credit race that a plain
  // "already owns it?" read cannot (two concurrent callers both read "no").
  /* Claimed through the helper so a credit that fails halfway gives the claim
     back and the provider's retry - or the reconcile sweep - can finish it.
     Taking the claim and then failing used to be recoverable only because the
     claim expired in thirty seconds; now that it is permanent, the release has
     to be deliberate. */
  const _sale = await _onceOrRetry(env, 'sale', `${buyer}:${itemId}`, CLAIM_ONCE_TTL_S,
    async () => { await _creditSaleWork(env, { itemId, buyer, seller, amountCents, ref }); });
  return _sale.value;
}

/* The credit itself. Separated only so the claim above wraps ALL of it - there
   is no partial success here worth keeping: either the buyer owns it and the
   seller was paid, or the whole thing is retried. */
async function _creditSaleWork(env, { itemId, buyer, seller, amountCents, ref }) {
  const it = await _getListing(env, itemId);
  const price = amountCents != null ? amountCents / 100 : (it ? it.price : 0);
  const sellerEmail = seller || (it && it.authorEmail) || '';
  // grant ownership to the buyer
  await env.AMV_KV.put(`entitleitem:${buyer}:${itemId}`, '1');
  /* AMV-207: a buyer's history, appended under the lock. Access to the item is
     granted by entitleitem above and is not at risk here - what a lost write
     costs is the record of what they bought, which is the thing they look at to
     find it again. A refund landing beside a purchase used to lose one of the
     two. */
  /* AMV-043: THE SELLER, WRITTEN DOWN AT THE MOMENT OF THE SALE.

     Reviewing a seller used to be proved by walking the buyer's purchases and
     reading each LISTING to see who wrote it. So the proof depended on the
     listing still existing - and the person who decides whether it exists is
     the seller being reviewed. Delete the item and every buyer of it silently
     loses the ability to say anything about you, which is the one thing a
     reputation system must not let a seller do.

     It is not only deletion: a listing that moderation removes, or one that a
     restore did not bring back, takes the same reviews with it.

     Who somebody bought from is a fact about the transaction. It is recorded
     with the transaction now, so it survives whatever happens to the listing
     afterwards. */
  const bought = { id: itemId, title: it ? it.title : itemId, kind: it ? it.kind : 'prompt',
                   price, ts: Date.now(), seller: sellerEmail || (it ? String(it.authorEmail || '').toLowerCase() : '') };
  /* EVERY STEP HERE HAS TO SURVIVE BEING RUN TWICE.

     The claim around this is released when the work throws, so the retry can
     finish a sale that failed halfway - which means the steps that already
     succeeded run again. Granting the item and writing the snapshot are puts
     and do not care. This is an append, and it did care: a credit that failed
     at the wallet left the purchase recorded, and the retry recorded it again,
     so the buyer's history showed one item bought twice.

     A buyer can only own a listing once - marketBuy refuses a re-purchase - so
     the entry's own presence is the evidence. */
  let alreadyBought = false;
  await _withKV(env, 'purchases', buyer, (list) => {
    if (list.some((x) => x && x.id === itemId)) { alreadyBought = true; return; }
    /* Changed IN PLACE: the helper writes back the object it loaded, so a
       mutate that builds a new array would be a no-op that looked like a write. */
    list.unshift(bought);
    if (list.length > 500) list.length = 500;
  }, []);
  // AMV-037: snapshot the deliverable at purchase time. The buyer paid for THIS
  // content - a later seller edit or delete must never revoke their access.
  if (it) { try { await DB.put(env, 'mktsnap', `${buyer}:${itemId}`, { ...it, _boughtAt: Date.now() }); } catch (e) {} }
  // credit the seller 80%
  let credited = false;
  if (sellerEmail) {
    const sellerShare = +(price * (1 - MARKET_PLATFORM_FEE)).toFixed(2);
    /* THE MONEY STEP, ASKED WHETHER IT ALREADY HAPPENED - INSIDE THE LOCK.

       The retry has to be able to finish an unfinished sale without paying for
       a finished one, and the only place that question can be answered without
       racing is inside the wallet's own lock, against the wallet's own record.
       The hold written below carries this charge's `ref` and the item, so its
       presence IS the evidence that this sale was credited. Nothing else has
       to be trusted - not a marker written elsewhere, not the order the steps
       ran in.

       Holds are pruned once matured, at fourteen days. Every retry that can
       reach here happens within a provider's redelivery window, which is days,
       so the evidence is always still there when it is needed. */
    credited = await _withWallet(env, sellerEmail, (w) => {
    if ((w.holds || []).some((h) => h && h.item === itemId && (h.ref || '') === (ref || ''))) return false;
    w.balance = +(w.balance + sellerShare).toFixed(2);
    w.lifetime = +(w.lifetime + sellerShare).toFixed(2);
    /* Held until the dispute window has substantially passed. `at` is the sale
       time so a test - or a backfill - can age it, and `ref` ties the hold to
       the charge so a reversal can release exactly this one rather than
       guessing at an amount. */
    const at = Date.now();
    /* A ROLLING RESERVE, BECAUSE THE HOLD IS SHORTER THAN THE RISK.

       The 14-day hold answers "did this sale stick". It does not answer the
       real question, which is that a card dispute can arrive up to 120 days
       after the charge. Holding EVERYTHING for 120 days would be safe and
       would also make AMV useless to an honest seller, who would wait four
       months to be paid for work already delivered.

       So the money is split the way payment platforms split it: most of it
       clears on the short hold, and a small percentage of every sale is held
       across the full dispute window. That reserve is what a late chargeback
       is taken from, so a reversal at day 60 lands on money AMV still has
       rather than on money it has already sent. It is the seller's money and
       it is shown as theirs the whole time - it clears late, it is not lost. */
    const reserved = +(sellerShare * PAYOUT_RESERVE_PCT).toFixed(2);
    const clearing = +(sellerShare - reserved).toFixed(2);
    w.holds = (w.holds || []).concat({ amount: clearing, at, until: at + PAYOUT_HOLD_MS,
                                       ref: ref || '', item: itemId });
    if (reserved > 0) {
      w.holds = w.holds.concat({ amount: reserved, at, until: at + PAYOUT_RESERVE_MS,
                                 ref: ref || '', item: itemId, reserve: true });
    }
    /* Matured holds are dropped on every credit, not only on withdrawal. They
       were pruned in one place - the payout - so a seller who never withdrew
       accumulated one entry per sale for ever, in a record that is read and
       rewritten on every single sale. */
    _pruneMaturedHolds(w);
    return true;
    });
    /* NOT gated on `credited`. That was the first attempt and it was wrong in
       the way that matters: a sale which failed HERE, after the money moved,
       comes back with the credit already done - so keying these off the credit
       would skip for ever the exact steps that failed. Each one carries its own
       evidence instead, so it can tell a repeat from a resumption.

       `ref` and the item are what make this line identifiable as this sale. */
    await _pushWalletTx(env, sellerEmail, { type: 'sale', amount: sellerShare, gross: price,
      item: itemId, title: it ? it.title : itemId, buyer, ref: ref || '', ts: Date.now() });
    // record the platform's cut (your revenue) so it shows in admin finance. The
    // full charge is already in Stripe; this logs the marketplace fee distinctly.
    /* Given a stable id rather than a generated one, so a resumed sale records
       the fee it could not record the first time WITHOUT recording it twice.
       Gating this on whether the credit or the history line was new was the
       first attempt and it was wrong the same way both times: the retry exists
       to finish the steps that failed, so keying a step off an earlier step
       skips exactly the work that is missing. */
    const platformCut = +(price * MARKET_PLATFORM_FEE).toFixed(2);
    if (platformCut > 0) await _recordTxn(env, { id: 'mktfee_' + (ref || itemId) + '_' + itemId,
      provider: 'marketplace', email: buyer, amount: platformCut,
      currency: 'USD', kind: 'marketplace fee', status: 'succeeded', ref: itemId });
  }
  /* bump sale count; user listings are one-of-a-kind -> mark SOLD (leaves catalog)

     Skipped when this pass credited nothing, or a retry would count one sale
     twice on the listing every reader sees. A free listing has no seller and no
     credit to key on, so it uses the buyer's own history instead - the same
     evidence, one record over.

     The one thing this does not cover is a failure landing strictly between the
     wallet write and this line, which leaves the counter one short. That is the
     direction to be wrong in: a sale count that reads low is a display being
     modest, and the money is right. */
  /* NOT guarded, deliberately, and the reason is worth stating because a guard
     here looks obviously right. Nothing after this line can throw - the saleref
     write below swallows its own errors - so a pass that reaches this bump also
     finishes, takes the claim for good, and is never retried. The counter
     therefore cannot run twice. A guard would only be able to do one thing:
     skip the bump on a pass that is resuming, which is the pass that still owes
     the count. Guarding it loses sales from the listing; not guarding it cannot
     add any. */
  if (it) {
    /* AMV-204: the sale is recorded on the listing under the lock. This is the
       write a visitor's page view used to put back, which is how an item that
       had sold went back on sale. */
    await _withKV(env, 'market', itemId, (rec) => {
      if (!rec) return null;
      rec.sales = (rec.sales || 0) + 1; rec.installs = (rec.installs || 0) + 1;
      if (/^usr_/.test(itemId)) rec.status = 'sold';
    });
  }
  /* AMV-091: a reverse index from the payment to what it bought. Without it a
     refund or chargeback arrives as a charge id we cannot connect to anything,
     which is exactly why nothing was ever undone. */
  if (ref) {
    try {
      await env.AMV_KV.put(`saleref:${ref}`, JSON.stringify({
        itemId, buyer, seller: sellerEmail, price,
        sellerShare: sellerEmail ? +(price * (1 - MARKET_PLATFORM_FEE)).toFixed(2) : 0,
        /* Carried so a reversal can release exactly this sale's hold. */
        ref, at: Date.now(),
      }), { expirationTtl: 400 * 86400 });
    } catch (e) {}
  }
  audit(env, 'market_sale', { item: itemId, buyer, seller: sellerEmail, price });
}

/* Undo a marketplace sale that was refunded or charged back.

   Before this, none of it happened. The buyer kept the item, the seller kept
   the credit and could withdraw it, and the platform ate the whole charge -
   which makes "buy the expensive listing, charge it back" a way to take money
   out of AMV. The fraud register already had a signal for exactly this pattern;
   what it did not have was anything on the server that acted on it. */
/* Returns null for "this charge is not a marketplace sale", which is the
   signal the webhook uses to fall through to the subscription path.

   A corrupt `saleref:` record produced that same null, and the consequence was
   two wrongs at once. The marketplace sale was never reversed - the buyer kept
   the item, the seller kept the credit and could withdraw it, and the platform
   ate the whole charge, which is exactly the "buy the expensive listing, then
   charge it back" hole this function was written to close. And the fallthrough
   then treated a $9 listing chargeback as a SUBSCRIPTION dispute: it revoked
   the customer's whole plan to free and recorded an abuse strike against them.

   "I could not read it" is not "it is not one of mine", so it throws. The
   webhook catches that and refuses the event rather than deciding on it, and
   the provider retries - which is the right answer for a record that may be
   readable again in a moment, and the only answer that does not punish the
   wrong customer meanwhile. */
async function _reverseSale(env, ref, reason) {
  if (!ref) return null;
  let rec = null;
  const rawRef = await env.AMV_KV.get(`saleref:${ref}`);
  if (rawRef != null) {
    try { rec = JSON.parse(rawRef); }
    catch (e) {
      try { audit(env, 'record_corrupt', { key: `saleref:${ref}`, bytes: String(rawRef).length }); } catch (_) {}
      throw new UnreadableRecordError(`saleref:${ref}`, 'invalid JSON');
    }
  }
  if (!rec || !rec.itemId || !rec.buyer) return null;
  /* AMV-010: THE CLAIM WAS TAKEN BEFORE THE WORK AND KEPT WHEN IT FAILED.

     A refund followed by a dispute on the same charge must not claw the money
     back twice, so this is claimed once. The claim is PERMANENT - it has to be,
     or a redelivery weeks later would reverse the same sale again - and it was
     taken up front, before any of the four steps below.

     Every one of those steps can fail. If the wallet is locked by another
     writer, or the store blinks, the reversal stops halfway with the claim
     still held. The provider retries, the retry is discarded as a duplicate of
     work that never happened, and the outcome is the buyer keeping an item they
     charged back or the seller keeping money that was taken off the card. There
     is no error anywhere: from the outside a held claim and a completed
     reversal are the same thing.

     _creditSale had this fixed already, with a comment saying exactly why. The
     reversal - the half where the money goes the other way - was left on the
     bare claim. So it uses the same helper, which gives the claim back when the
     work throws and lets the retry finish it. */
  const _rev = await _onceOrRetry(env, 'salerev', ref, CLAIM_ONCE_TTL_S,
    async () => { await _reverseSaleWork(env, rec, reason); return rec; });
  return _rev.claimed ? _rev.value : null;
}

async function _reverseSaleWork(env, rec, reason) {
  // 1. The buyer does not keep what they did not pay for.
  /* NOT swallowed. A buyer who charges back and keeps the item is the attack
     this whole function exists to stop, so a failure to revoke has to reach the
     caller - which now releases the claim so the retry can finish it. Caught
     and discarded, it turned "AMV could not take it back" into "AMV took it
     back", permanently and silently.

     The snapshot delete stays tolerant: it is a copy of the deliverable, and
     the access records above are what actually decide whether the buyer keeps
     the item. */
  await env.AMV_KV.delete(`entitleitem:${rec.buyer}:${rec.itemId}`);
  try { await DB.del(env, 'mktsnap', `${rec.buyer}:${rec.itemId}`); } catch (e) {}
  await _withKV(env, 'purchases', rec.buyer, (list) => {
    const keep = list.filter(p => p && p.id !== rec.itemId);
    list.length = 0;
    for (const p of keep) list.push(p);
  }, []);

  /* 2. The seller does not keep the money. The balance is allowed to go
     NEGATIVE: a seller who already withdrew must not be able to outrun the
     reversal by being fast, and withdrawals are gated on a positive balance, so
     the debt is paid down by their next sales. */
  if (rec.seller && rec.sellerShare > 0) {
    await _withWallet(env, rec.seller, (w) => {
    w.balance = +((+w.balance || 0) - rec.sellerShare).toFixed(2);
    w.lifetime = +Math.max(0, (+w.lifetime || 0) - rec.sellerShare).toFixed(2);
    /* Release this sale's hold. Leaving it would keep freezing money for a sale
       that no longer exists - the seller would be short twice, once for the
       reversal and once for a hold against nothing. Matched on the charge
       reference, falling back to the item, so it releases THIS sale rather than
       whichever hold happens to be the same size. */
    /* EVERY hold for this sale, not the first one found.

       A sale now leaves TWO holds: the part that clears on the short window
       and the reserve slice that clears across the dispute window. They share
       a reference, so releasing one by index left the other frozen against a
       sale that no longer exists - the seller short by the reserve, invisibly,
       for four months. That is the exact failure the note above describes, and
       adding the reserve reintroduced it.

       Matched on the charge reference, falling back to the item, so it
       releases THIS sale's holds rather than whichever happen to be the same
       size. */
    const holds = (w.holds || []);
    const byRef = rec.ref ? holds.filter(h => h.ref && h.ref === rec.ref) : [];
    const drop = byRef.length ? byRef : holds.filter(h => h.item === rec.itemId);
    w.holds = holds.filter(h => !drop.includes(h));
    _pruneMaturedHolds(w);
    });
    await _pushWalletTx(env, rec.seller, { type: 'sale_reversed', amount: -rec.sellerShare,
      item: rec.itemId, buyer: rec.buyer, reason, ts: Date.now() });
  }

  // 3. A one-of-a-kind listing goes back on sale rather than staying "sold".
  try {
    const it = await _getListing(env, rec.itemId);
    if (it) {
      await _withKV(env, 'market', rec.itemId, (cur) => {
        if (!cur) return null;
        cur.sales = Math.max(0, (cur.sales || 1) - 1);
        if (/^usr_/.test(rec.itemId) && cur.status === 'sold') cur.status = 'active';
      });
    }
  } catch (e) {}

  // 4. The buyer is recorded, because doing this repeatedly is the attack.
  await _abuseRecord(env, rec.buyer, reason === 'dispute' ? 'dispute' : 'refund',
                     { marketItem: rec.itemId, amount: rec.price });
  audit(env, 'market_sale_reversed', { item: rec.itemId, buyer: rec.buyer, seller: rec.seller,
                                       price: rec.price, reason });
  await notify(env, `Marketplace ${reason}: $${(+rec.price || 0).toFixed(2)} on ${rec.itemId}. Buyer access revoked, seller credit clawed back.`);
}
/* Same rule as `_wallet`: absent means they have bought nothing, unreadable
   means AMV does not know. Swallowed, the two were the same answer, and the
   library screen says "No purchases yet" to a buyer who has paid - which the
   client already calls the worst way for this to be wrong, in a comment
   guarding the case where the REQUEST fails. This is the case where it
   succeeds and returns a lie. */
async function _purchasesList(env, email) {
  const raw = await env.AMV_KV.get(`purchases:${email}`);
  if (raw != null) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      try { audit(env, 'record_corrupt', { key: `purchases:${email}`, bytes: String(raw).length }); } catch (_) {}
      throw new UnreadableRecordError(`purchases:${email}`, 'invalid JSON');
    }
  }
  return [];
}

/* Buyer's library: items they've purchased, WITH the unlocked deliverable. */
async function marketPurchases(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* An unreadable record here is the difference between "you have bought
     nothing" and "AMV cannot tell you what you own", and only one of those is
     something to say to somebody who has paid. */
  let list;
  try { list = await _purchasesList(env, user.email); }
  catch (e) {
    if (!(e instanceof UnreadableRecordError)) throw e;
    try { await alertOnce(env, 'purchases_corrupt', 'A buyer purchase record is unreadable, so their library cannot be listed. Check the audit log for record_corrupt.', 60); } catch (_) {}
    return json({ error: 'AMV could not read your library right now, so it will not tell you it is empty. Nothing has been lost - everything you have bought is still yours. This has been reported.',
                  code: 'purchases_unreadable' }, 503);
  }
  const items = [];
  for (const p of list) {
    // AMV-037: serve the immutable snapshot taken at purchase - the buyer keeps
    // full access to what they paid for even if the seller later edited or
    // deleted the listing. Fall back to the live listing for legacy purchases.
    const snap = await DB.get(env, 'mktsnap', `${user.email}:${p.id}`);
    if (snap) { items.push({ ...snap, _purchasedAt: p.ts }); continue; }
    const it = await _getListing(env, p.id);
    if (it) items.push({ ...it, _purchasedAt: p.ts });
    else items.push({ ...p, _removed: true });
  }
  return json({ ok: true, items });
}

/* Seller's own listings + sale counts. */
async function marketMyListings(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* Their own ids, then their own records. What this used to do was read every
     listing in the product and throw away the ones belonging to somebody else. */
  const idx = await _sellerListingIds(env, user.email);
  const out = [];
  for (const id of idx.ids) {
    const it = await _getListing(env, id);
    /* An id in the index whose record is gone is not an error worth showing
       somebody - it is a removal that raced this read, or an old entry. It is
       dropped here and tidied on the next write. */
    if (it) out.push(it);
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ ok: true, items: out,
    /* Only ever true on the one-time backfill for a catalogue larger than the
       scan bound, and said out loud rather than quietly showing fewer items
       than somebody has. */
    truncated: idx.truncated || undefined,
    note: idx.truncated
      ? 'Some of your listings could not be indexed in one pass. They are safe - reload in a moment and the rest will appear.'
      : undefined });
}
async function marketUnlist(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id } = await request.json().catch(() => ({}));
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'not found' }, 404);
  if (it.authorEmail !== user.email) return json({ error: 'not your listing' }, 403);
  await env.AMV_KV.delete(`market:${id}`);
  await _sellerIndexRemove(env, user.email, id);
  await _marketCacheBust(env);
  audit(env, 'market_unlist', { id, by: user.email });
  return json({ ok: true });
}

/* Seller wallet: balance, lifetime earnings, recent transactions. */
async function marketEarnings(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* The wallet is the numbers. If it cannot be read there is nothing honest to
     put on this screen, so the failure goes to the client whole rather than as
     a zero - and the client already says "could not load your earnings,
     nothing has changed" rather than inventing a balance. */
  let w;
  try { w = await _wallet(env, user.email); }
  catch (e) {
    if (!(e instanceof UnreadableRecordError)) throw e;
    try { await alertOnce(env, 'wallet_corrupt', 'A seller wallet record is unreadable, so their balance cannot be shown. Check the audit log for record_corrupt.', 60); } catch (_) {}
    return json({ error: 'AMV could not read your balance right now, so it will not guess at it. Nothing has changed - your money is where it was. This has been reported.',
                  code: 'wallet_unreadable' }, 503);
  }
  /* The history is separate, and losing it does not make the numbers wrong. So
     it degrades on its own: the balances still show, and the list says it
     could not be read instead of "No earnings yet" - which to somebody with a
     lifetime total on the same screen is both false and self-contradictory. */
  let tx = [], txUnavailable = false;
  try { tx = await _walletTx(env, user.email); }
  catch (e) {
    if (!(e instanceof UnreadableRecordError)) throw e;
    txUnavailable = true;
  }
  /* Three numbers, not one. "Balance" alone meant a seller saw money they could
     not take and had no way to learn why - which reads as AMV keeping it. What
     has cleared, what is still clearing, and how long that takes. */
  const available = _availableOf(w);
  const pending = +Math.max(0, (+w.balance || 0) - available).toFixed(2);
  /* The list is capped at 50 and the heading says "Transaction history", which
     claims completeness the response cannot support. The count and the flag go
     with it so the screen can say which 50 these are - the same rule every
     bounded scan here already follows. */
  const TX_SHOWN = 50;
  return json({ ok: true, balance: w.balance, available, pending,
                holdDays: PAYOUT_HOLD_DAYS, availableAt: _nextClearingAt(w) || null,
                lifetime: w.lifetime, currency: w.currency || 'usd', minWithdraw: MARKET_MIN_WITHDRAW,
                sellerPct: Math.round((1 - MARKET_PLATFORM_FEE) * 100),
                tx: tx.slice(0, TX_SHOWN), txTotal: tx.length,
                txTruncated: tx.length > TX_SHOWN, txUnavailable });
}

/* Extraction: seller requests a withdrawal of their balance. Records a
   pending payout and zeroes the balance (operator fulfills it via the
   destination on file). Idempotent-ish via a unique request id. */
/* MONEY THAT LEFT A BALANCE FOR A PAYOUT THAT WAS NEVER WRITTEN.

   The withdrawal debits first and writes the payout record second, because the
   other order is a way to be paid twice. That leaves one narrow state: debited,
   with a marker naming the payout, and no record - which happens if the request
   is cut off between the two. The rollback in the withdrawal handles an
   exception; nothing can handle the Worker simply ending, so this does.

   Checked at the top of the next withdrawal, under the same lock, which is the
   only moment it matters and costs one read only when a marker exists - which
   is to say almost never. A marker whose record DOES exist is left alone: that
   payout is real and the money is genuinely gone. */
async function _reconcileStrandedPayouts(env, email) {
  const w = await _wallet(env, email);
  const pending = Array.isArray(w.pendingOut) ? w.pendingOut : [];
  if (!pending.length) return 0;
  const stranded = [];
  for (const p of pending) {
    if (!p || !p.id) continue;
    let rec = null;
    try { rec = await env.AMV_KV.get(`withdraw:${p.id}`); }
    catch (e) { return 0; }   // cannot tell: leave it rather than refund twice
    if (!rec) stranded.push(p);
  }
  if (!stranded.length) {
    /* Every marker has a record behind it, so they are all settled business. */
    await _withWallet(env, email, (ww) => { ww.pendingOut = []; });
    return 0;
  }
  const total = +stranded.reduce((n, p) => n + (+p.amount || 0), 0).toFixed(2);
  await _withWallet(env, email, (ww) => {
    ww.balance = +((+ww.balance || 0) + total).toFixed(2);
    const ids = new Set(stranded.map((p) => p.id));
    ww.pendingOut = (Array.isArray(ww.pendingOut) ? ww.pendingOut : []).filter((p) => p && !ids.has(p.id));
  });
  audit(env, 'withdraw_stranded_returned', { seller: email, amount: total, ids: stranded.map((p) => p.id) });
  return total;
}

async function marketWithdraw(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const ageBadW = await _moneyAgeGate(env, user.email);
  if (ageBadW) return json(ageBadW, ageBadW.code === 'age_required' ? 428 : 403);
  /* The one place the hold stops money LEAVING rather than being spent, and
     the one where it is irreversible: a payout is a transfer AMV cannot claw
     back, so an account blocked for charging back must not be able to take
     cash out while an operator is still looking at it. Nothing is lost by
     waiting - the balance stays theirs, and clearing the block releases it. */
  {
    const heldW = await _accountHold(env, user, 'withdraw');
    if (heldW) return heldW;
  }
  const { destination } = await request.json().catch(() => ({}));
  /* Taking money OUT is the one a parent most needs to be able to stop. */
  if (user.family && user.family.limits && !user.family.limits.payouts) {
    return json({ error: 'Withdrawing money is turned off for your account. Whoever manages your family can turn it on.',
                  code: 'family_blocked' }, 403);
  }
  /* Where the money is meant to GO. Only the browser checked this, so a request
     without it zeroed the seller's balance and wrote a pending payout the
     operator had no way to fulfil - the money left the balance and arrived
     nowhere, which is the same failure AMV-089 was written to end. Checked
     BEFORE anything is debited, and AFTER the family block: somebody who may
     not withdraw at all is told that, rather than being asked to fill in a
     destination for a withdrawal that was never going to be allowed. */
  const dest = String(destination == null ? '' : destination).trim().slice(0, 200);
  if (dest.length < 3) {
    return json({ error: 'Tell AMV where to send the money - a PayPal email or a bank reference. Nothing has been withdrawn.',
                  code: 'destination_required' }, 400);
  }
  // Serialize withdrawals per seller so two concurrent requests can't both read
  // the same balance and each create a payout for it (double withdrawal). The
  // lock is atomic on D1; on KV it is a best-effort short-TTL guard. Balance is
  // re-read INSIDE the lock.
  if (!(await _claimOnce(env, 'wdlock', user.email, 30))) {
    return json({ error: 'A withdrawal is already being processed. Please try again in a moment.' }, 409);
  }
  try {
    /* Anything a previous attempt debited for a payout that was never written
       goes back before this one decides what is available. Under the same lock,
       so it cannot race the withdrawal it is correcting. */
    try { await _reconcileStrandedPayouts(env, user.email); }
    catch (e) { audit(env, 'withdraw_reconcile_failed', { seller: user.email, error: String((e && e.message) || e).slice(0, 160) }); }
    /* A wallet that cannot be read used to come back as a fresh zero, so this
       path answered "Minimum withdrawal is $10. You have $0.00 available." to
       a seller with money - a specific, confident, false number, at the one
       moment they are trying to get paid. It refuses, and says which. */
    let w;
    try { w = await _wallet(env, user.email); }
    catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      try { await alertOnce(env, 'wallet_corrupt', 'A seller wallet record is unreadable, so a withdrawal was refused. Check the audit log for record_corrupt.', 60); } catch (_) {}
      return json({ error: 'AMV could not read your balance, so it will not process a withdrawal against a number it does not have. Nothing has been debited and your money is untouched. This has been reported.',
                    code: 'wallet_unreadable' }, 503);
    }
    /* Only what has cleared. The balance may be larger - held money is still
       theirs and still shown - but it cannot leave until the dispute window has
       substantially passed, or a seller could outrun a chargeback and leave AMV
       holding it. */
    const available = _availableOf(w);
    if (available < MARKET_MIN_WITHDRAW) {
      const nextAt = _nextClearingAt(w);
      const held = +((+w.balance || 0) - available).toFixed(2);
      /* Said as a matter of time rather than a refusal, because for an honest
         seller that is exactly what it is. */
      const when = nextAt
        ? ' $' + held.toFixed(2) + ' is still clearing and becomes available on '
          + new Date(nextAt).toISOString().slice(0, 10) + '.'
        : '';
      return json({ error: `Minimum withdrawal is $${MARKET_MIN_WITHDRAW}. You have $${available.toFixed(2)} available.` + when,
                    code: 'not_cleared', available, held, holdDays: PAYOUT_HOLD_DAYS,
                    availableAt: nextAt || null }, 400);
    }
    const amount = available;
    const wid = 'wd_' + crypto.randomUUID().slice(0, 12);

    /* DECIDED HERE, so the queue is the exceptions rather than the business.
       A payout with nothing against it clears itself; anything with a reason
       goes to a person, carrying the reasons so they are deciding rather than
       guessing. 'blocked' still creates the record - the seller is told, the
       money stays theirs, and an operator can override - because a scoring
       system that can silently delete somebody's earnings is worse than the
       fraud it prevents. */
    const risk = await _payoutRisk(env, user.email, amount, w);
    const status = risk.tier === 'auto' ? 'approved' : 'pending';

    /* THE MONEY LEAVES THE BALANCE BEFORE ANYTHING PROMISES IT.

       This wrote the payout record first and debited afterwards, and the gap
       between the two was a way to be paid twice. Nothing subtracts a payout
       already in flight when working out what is available - `_availableOf` is
       balance minus unmatured holds, and `_payoutsInFlight` is only ever read
       as a risk signal - so a debit that did not happen left the full amount
       still withdrawable with an approved payout already standing against it.
       The seller asks again, a second record is written, and an operator
       working the queue sends the money twice.

       It does not take an exception. A Worker can be cut off mid-request, and
       the window was two storage writes wide.

       So the debit comes first, in the lock, together with a marker naming the
       payout it is for. Between here and the record being written the money is
       neither spendable nor promised, which is the only state that cannot be
       double-spent. `_reconcileStrandedPayouts` above puts it back if the
       record never appeared. */
    /* Take out only what left. This used to zero the whole balance, which was
