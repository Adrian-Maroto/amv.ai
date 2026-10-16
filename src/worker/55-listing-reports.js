  if (!(await _ownsItem(env, user.email, id))) return json({ error: 'buy it before rating' }, 403);
  /* AMV-043: the snapshot taken at purchase stands in for a listing the seller
     has since taken down. Somebody who paid for a thing may say what they
     thought of it, and whether the seller still offers it is not their
     business - a rating that disappears when the seller withdraws the item is a
     rating the seller controls. */
  const it = (await _getListing(env, id))
          || (await DB.get(env, 'mktsnap', `${user.email}:${id}`).catch(() => null));
  if (!it) return json({ error: 'not found' }, 404);
  /* PSEUDONYMOUS, LIKE THE REVIEWS RIGHT BELOW THIS.

     This used to store map[user.email] = stars. The record is keyed by the
     LISTING - somebody else's listing - so it is not in PER_USER_KINDS and it
     could not be: erasing the rater's account cannot reach a record filed under
     a seller's item. A rater's address therefore outlived their own deletion,
     with nothing anywhere able to find it.

     marketReview, the function immediately after this one, already stores a
     one-way hash and says why in its own comment: never the raw email, so a
     list can be shown publicly without leaking addresses. The same record, the
     same reasoning, one function apart, and only one of them did it.

     Existing maps are migrated in place. The keys ARE the addresses, and the
     hash is a pure function of the address, so every old key can be converted
     here without needing to know whose it is - and the average, which is all
     anybody reads, does not move. */
  /* AMV-042: THIS RECORD IS KEYED BY THE LISTING, SO ITS WRITERS ARE EVERY BUYER.

     Read-modify-write on a record one person owns is a race between their own
     tabs. On a record keyed by somebody else's LISTING it is a race between
     strangers: two buyers rating the same item at the same moment both read the
     map, both add themselves, and the later write drops the earlier rating.
     Popular items - the ones with the most raters - are exactly where it
     happens most, and the only symptom is a rating count that is quietly lower
     than the number of people who rated.

     The hashing and the migration move inside the lock with everything else.
     They read the map and rewrite every key in it, which is the largest
     read-modify-write in this function and was the one furthest from any lock. */
  const IS_HASH = /^[0-9a-f]{16}$/;
  const mine = await _errHash(user.email.toLowerCase());
  /* The hashes are computed before the lock: the mutate below is synchronous,
     and awaiting inside it would hold the lock across storage calls for every
     existing rater. */
  const preHashed = new Map();
  {
    let seed = {};
    try { const raw = await env.AMV_KV.get(`mkrate:${id}`); if (raw) seed = JSON.parse(raw); } catch {}
    for (const who of Object.keys(seed)) {
      if (!IS_HASH.test(who)) preHashed.set(who, await _errHash(String(who).toLowerCase()));
    }
  }
  let vals = [];
  await _withKV(env, 'mkrate', id, (map) => {
    const migrated = {};
    for (const [who, val] of Object.entries(map)) {
      /* A key that arrived between the pre-hash pass and the lock is left as it
         is rather than dropped - it is somebody's rating, and the next writer
         migrates it. Losing it to be tidy would be the defect this fixes. */
      migrated[IS_HASH.test(who) ? who : (preHashed.get(who) || who)] = val;
    }
    for (const k of Object.keys(map)) delete map[k];
    Object.assign(map, migrated);
    map[mine] = s;
    vals = Object.values(map);
  }, {});
  const rating = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  /* AMV-204: the average goes onto the listing under the lock. Written from a
     copy read before a sale or a status change landed, a rating put the old
     record back - so an item that had just sold went back on sale because
     somebody rated it. */
  await _withKV(env, 'market', id, (rec) => {
    if (!rec) return null;
    rec.rating = rating;
    rec.ratings = vals.length;
  });
  return json({ ok: true, rating, ratings: vals.length });
}

/* Buyer reviews a SELLER (person) with 1-5 stars + text. Gated: must have
   bought at least one of that seller's listings. Stored under the seller. */
/* ══════════════════════════════════════════════════════════════
   REPORTING A LISTING - THE THING THE POLICY SAID ALREADY HAPPENED.

   The marketplace policy screen tells buyers, in the product, that "buyers can
   report any listing; reports are reviewed by our team". None of that existed.
   There was a _mktReport dialog in the browser that nothing opened, and if
   anything had opened it, it wrote the report to localStorage - in the
   REPORTER'S OWN BROWSER, where the only person who could ever read it is the
   person complaining. There was no route here at all.

   That is the worst shape a safety promise can take: somebody sees an abusive
   listing, believes they have told the platform, and nobody has been told.
   For a marketplace that takes payments and pays sellers out, the policy is
   also the thing an operator would be held to.

   So it is real. A report is a durable record on the server, it is audited, it
   alerts the operator, three of them hide the listing pending a decision, and
   the operator has a screen that lists them.

   Keyed by listing, not by reporter, because the question anybody asks later
   is "what has been said about THIS listing" - and because a per-reporter key
   would put somebody else's complaint inside the reported seller's own erasure
   scope. */
const REPORT_REASONS = new Set(['scam', 'stolen', 'illegal', 'sexual', 'harassment', 'broken', 'other']);
/* Enough independent reports that leaving it up is the bigger risk. Low on
   purpose: a wrongly hidden listing is one operator click to restore, and a
   scam left up while a queue is read is somebody's money. */
const REPORT_AUTOHIDE = 3;

async function marketReport(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in to report a listing.' }, 401);
  /* Bounded: a report route is also a way to bury a competitor under noise,
     and a way to make AMV write storage as fast as somebody can click. */
  const g = await guardAction(env, `mktreport:${user.email}`, 5, 30, 'reporting listings');
  if (g) return g;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').slice(0, 80);
  const reason = String(body.reason || 'other');
  const note = String(body.note || '').slice(0, 1000);
  if (!id) return json({ error: 'Which listing?' }, 400);
  if (!REPORT_REASONS.has(reason)) return json({ error: 'Pick one of the listed reasons.' }, 400);

  const it = await _getListing(env, id);
  if (!it) return json({ error: 'That listing no longer exists.' }, 404);
  if ((it.authorEmail || '').toLowerCase() === user.email.toLowerCase())
    return json({ error: 'That is your own listing.' }, 400);

  /* Under the record's lock, because several people reporting the same listing
     at the same moment is the NORMAL case for anything worth reporting - and
     losing all but one of them is losing exactly the signal that mattered. */
  const byId = await _errHash(user.email.toLowerCase());
  let rec;
  try {
    rec = await _withKind(env, 'mktreport', id, (r) => {
      r.itemId = id;
      r.title = String(it.title || '').slice(0, 140);
      r.seller = it.authorEmail || '';
      r.reports = Array.isArray(r.reports) ? r.reports : [];
      /* One per person per listing. A second report from the same account
         updates what they said rather than counting twice, so the count means
         "how many different people" - which is the only version of the number
         worth acting on.

         Identified by a one-way hash, never the address. This record is keyed
         by the LISTING, so it sits outside the reporter's own erasure scope -
         and a complaint about somebody else's listing must not be the thing
         that keeps a reporter's email on the server after they have asked for
         it to be gone. The hash still dedupes, which is all it was for. */
      const prior = r.reports.find(x => x.by === byId);
      if (prior) { prior.reason = reason; prior.note = note; prior.ts = Date.now(); }
      else r.reports.push({ by: byId, reason, note, ts: Date.now() });
      /* Deduped per reporter, so this grows with distinct PEOPLE rather than
         with complaints - but distinct people is still unbounded, and the
         count that drives the auto-hide only needs the recent ones. */
      if (r.reports.length > 500) r.reports = r.reports.slice(-500);
      r.count = r.reports.length;
      r.lastAt = Date.now();
      if (!r.status) r.status = 'open';
      /* _withRecord hands back whatever the mutate returns, and writes back the
         object it loaded. Both matter here: the record is mutated IN PLACE so
         the write is the updated one, and it is returned so the count below is
         the count that was actually stored rather than one read again after
         the lock was let go. */
      return r;
    }, { itemId: id, reports: [], status: 'open' });
  } catch (e) {
    if (_isBusy(e)) return _busyJson('report');
    throw e;
  }

  audit(env, 'market_reported', { by: user.email, itemId: id, reason, count: rec.count });

  /* Enough people have said something that leaving it visible while a queue is
     read is the bigger risk. Hidden, not deleted - the seller keeps the work
     and the operator decides. */
  let hidden = false;
  if (rec.count >= REPORT_AUTOHIDE && !it.hidden) {
    try {
      await _withKind(env, 'market', id, (m) => {
        if (!m || !m.id) return;
        m.hidden = true;
        m.hiddenReason = 'reported';
        m.hiddenAt = Date.now();
      }, null);
      hidden = true;
      /* Out of the catalogue now. Auto-hiding is the response to enough people
         saying something is wrong, and leaving it on the front page for
         another minute is the exact risk the auto-hide exists to cut. */
      await _marketCacheBust(env);
      audit(env, 'market_autohidden', { itemId: id, count: rec.count });
    } catch (e) { if (!_isBusy(e)) throw e; }
  }

  try {
    await notify(env, `Listing reported (${rec.count}x): "${rec.title}" by ${rec.seller || 'unknown'} - reason: ${reason}.`
      + (hidden ? ' Hidden automatically pending review.' : ''));
  } catch (e) {}

  return json({ ok: true, count: rec.count, hidden,
    message: hidden
      ? 'Thank you. Enough people have reported this that it is now hidden while it is reviewed.'
      : 'Thank you. This has been sent for review.' });
}

/* What came in, for the person who has to act on it. */
async function adminReports(request, env) {
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  /* DB.list hands back {id, value} rows, not the records themselves. Reading
     r.count off the wrapper gave every listing a count of zero and no seller -
     an operator screen that answers confidently with nothing in it, which is
     worse than one that fails. */
  const { rows, truncated } = await scan(env, 'mktreport', 2000, 'marketplace reports screen');
  const open = rows.map(r => r.value || {}).filter(r => (r.status || 'open') === 'open');
  open.sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastAt || 0) - (a.lastAt || 0));
  return json({
    ok: true,
    reports: open.slice(0, 200).map(r => ({
      itemId: r.itemId, title: r.title, seller: r.seller, count: r.count || 0,
      lastAt: r.lastAt || 0,
      reasons: [...new Set((r.reports || []).map(x => x.reason))],
      notes: (r.reports || []).map(x => x.note).filter(Boolean).slice(0, 5),
    })),
    openCount: open.length,
    total: rows.length,
    truncated,
    autoHideAt: REPORT_AUTOHIDE,
  });
}

async function marketReview(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { seller, stars, text } = await request.json().catch(() => ({}));
  const sellerEmail = String(seller || '').toLowerCase();
  if (!sellerEmail || sellerEmail === user.email) return json({ error: 'invalid seller' }, 400);
  /* AMV-043: from the purchase itself where it is recorded, and only then from
     the listing - which may not exist any more, and whose existence is the
     seller's own decision. The snapshot taken at purchase is the third place to
     look, because it is the copy a seller cannot touch. */
  const purchases = await _purchasesList(env, user.email);
  let bought = false;
  for (const p of purchases) {
    if (!p) continue;
    if (String(p.seller || '').toLowerCase() === sellerEmail) { bought = true; break; }
    /* Older purchases, recorded before the seller was written down. */
    if (!p.seller) {
      const snap = await DB.get(env, 'mktsnap', `${user.email}:${p.id}`).catch(() => null);
      if (snap && String(snap.authorEmail || '').toLowerCase() === sellerEmail) { bought = true; break; }
      const it = await _getListing(env, p.id);
      if (it && (it.authorEmail || '').toLowerCase() === sellerEmail) { bought = true; break; }
    }
  }
  if (!bought) return json({ error: 'You can only review sellers you\u2019ve bought from.' }, 403);
  const s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
  const key = `mkreview:${sellerEmail}`;
  // Screen review text - user-generated content that displays publicly.
  const reviewText = String(text || '').slice(0, 1000);
  const rScreen = _marketScreen({ text: reviewText, title: '' });
  if (!rScreen.ok && rScreen.action === 'blocked') {
    audit(env, 'market_review_blocked', { by: user.email, category: rScreen.category });
    return json({ error: 'Your review contains content that isn\u2019t allowed.', code: 'policy_violation' }, 422);
  }
  // AMV-059: store a PSEUDONYMOUS reviewer id (a non-reversible hash of the
  // email) for one-review-per-buyer dedup, plus a display name - never the raw
  // email, so a review list can be shown publicly without leaking addresses.
  const byId = await _errHash(user.email.toLowerCase());
  const entry = { byId, byName: (user.name || user.email.split('@')[0]).slice(0, 40), stars: s, text: reviewText, ts: Date.now() };
  /* AMV-042: keyed by the SELLER, so every buyer of theirs writes it. Two
     reviews landing together both read the list, both add themselves, and one
     disappears - and the buyer who lost is told their review was posted. */
  await _withKV(env, 'mkreview', sellerEmail, (list) => {
    const existing = list.findIndex(r => (r.byId || '') === byId || (r.by || '').toLowerCase() === user.email.toLowerCase());
    if (existing >= 0) list[existing] = entry; else list.unshift(entry);
    if (list.length > 500) list.length = 500;
  }, []);
  audit(env, 'market_review', { seller: sellerEmail, by: user.email, stars: s });
  return json({ ok: true, review: entry });
}

/* Deterministic thread id for a pair (order-independent) so both share one. */
function _threadId(a, b) { return 'mkthread:' + [String(a || '').toLowerCase(), String(b || '').toLowerCase()].sort().join('__'); }

/* A THREAD ID FROM A CALLER IS NOT A STORAGE KEY UNTIL IT LOOKS LIKE ONE.

   Two routes took `body.thread` and handed it straight to the namespace - one
   of them for a WRITE. Nothing bad happens today, because the membership check
   underneath needs the record to have `a` or `b` equal to the caller and only
   thread records have those. That is the whole guard, and it is a guard made
   of somebody else's schema: the day any other record gains an `a` or a `b`
   holding an address, this becomes a way to read and overwrite it by name.

   Every other route in this file validates before keying - a listing id, a
   payout id, a slug, a rating id. This is the one that did not, and the shape
   is fixed and cheap to insist on. */
const _threadKeyOK = (tid) =>
  /^mkthread:[^\s:]{1,120}__[^\s:]{1,120}$/.test(String(tid || ''));

/* Send a message to another user (buyer<->seller). Appends to the shared thread. */
/* WHO A MESSAGE IS ALLOWED TO REACH.

   AMV-185: the recipient used to be whatever address the caller typed. That
   makes this endpoint a way to put text into any inbox on the internet with
   AMV's name on the envelope, and no amount of screening the words fixes what
   the thing IS.

   So the recipient is derived, never supplied: from the listing being asked
   about, or from a conversation this account is already part of. Both are
   things the sender can only name because they already have a legitimate
   reason to. A raw address is accepted ONLY when it belongs to an existing AMV
   account AND a conversation with them already exists - which is a reply, not
   a first contact.

   Asking a seller a question before buying stays open on purpose. It is the
   question that starts most sales, and gating it behind a purchase would be
   protecting the marketplace from working. */
async function _messageRecipient(env, user, body) {
  const me = String(user.email).toLowerCase();

  /* About a listing: the seller is whoever published it. */
  if (body.item) {
    const it = await _getListing(env, String(body.item));
    if (!it) return { error: 'That listing no longer exists.', status: 404 };
    const seller = String(it.authorEmail || '').toLowerCase();
    if (!seller) return { error: 'That listing has no seller to message.', status: 404 };
    if (seller === me) return { error: 'That is your own listing.', status: 400 };
    return { email: seller, about: { id: it.id, title: it.title } };
  }

  /* A conversation that already exists, and that this account is part of. */
  const tid = body.thread ? String(body.thread) : '';
  if (tid) {
    /* Same guard as marketThreadRead: shaped like a thread key before it is
       used as one, so the membership test below is a second line rather than
       the only one. */
    if (!_threadKeyOK(tid)) return { error: 'That conversation does not exist.', status: 404 };
    let t = null;
    try { const raw = await env.AMV_KV.get(tid); if (raw) t = JSON.parse(raw); } catch (e) {}
    if (!t) return { error: 'That conversation does not exist.', status: 404 };
    const a = String(t.a || '').toLowerCase(), b = String(t.b || '').toLowerCase();
    if (a !== me && b !== me) return { error: 'That is not your conversation.', status: 403 };
    return { email: a === me ? b : a, thread: t };
  }

  /* A bare address: only as a reply into a conversation that already exists.
     A first message to a typed address is exactly the case being closed. */
  const typed = String(body.to || '').toLowerCase();
  if (!typed) return { error: 'Say who this is for - a listing, or a conversation.', status: 400 };
  if (typed === me) return { error: 'You cannot message yourself.', status: 400 };
  const key = _threadId(me, typed);
  let existing = null;
  try { const raw = await env.AMV_KV.get(key); if (raw) existing = JSON.parse(raw); } catch (e) {}
  if (!existing) {
    /* Deliberately the same answer whether or not that address has an account.
       "No such person" would turn this into a way to test which addresses are
       registered here. */
    return { error: 'You can only message people through one of their listings, or a conversation you already have.',
             status: 403, code: 'no_thread' };
  }
  return { email: typed, thread: existing };
}

async function marketMessage(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  // Messaging reaches another user - guard against spam/harassment.
  const blocked = await guardAction(env, `mktmsg:${user.email}`, 15, 300, 'messages');
  if (blocked) return blocked;
  const reqBody = await request.json().catch(() => ({}));
  const { text } = reqBody;
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) return json({ error: 'empty message' }, 400);

  const who = await _messageRecipient(env, user, reqBody);
  if (who.error) return json({ error: who.error, code: who.code }, who.status || 400);
  const other = who.email;
  if (other === String(user.email).toLowerCase()) return json({ error: 'invalid recipient' }, 400);
  // Screen private messages - block prohibited content (illegal offers, CSAM, etc.)
  const mScreen = _marketScreen({ text: body, title: '' });
  if (!mScreen.ok && mScreen.action === 'blocked') {
    audit(env, 'market_message_blocked', { by: user.email, category: mScreen.category });
    return json({ error: 'That message contains content that isn\u2019t allowed on the marketplace.', code: 'policy_violation' }, 422);
  }
  const key = _threadId(user.email, other);
  /* AMV-196: READ, APPEND, WRITE - AND THE OTHER PERSON'S REPLY IS GONE.

     A thread has two writers by definition. Both replying in the same moment
     read the same thread and both write it back, so one message vanishes: no
     error anywhere, and the sender keeps seeing it in their own copy of the
     conversation. They find out it never arrived when the other person answers
     something else, or never answers at all.

     `who.thread` is the copy _messageRecipient read BEFORE any of this, so it
     is used only when there is nothing stored at all - otherwise appending to
     it would be the same lost write with an extra step. */
  let t = null;
  try {
    t = await _withRecord(env, 'mktthread', key,
      async (e, k) => { try { const raw = await e.AMV_KV.get(k); return raw ? JSON.parse(raw) : null; } catch (err) { return null; } },
      async () => {},                    // written explicitly below, inside the lock
      async (stored) => {
        let th = stored || who.thread || null;
        if (!th) th = { id: key, a: user.email, b: other, aName: user.name || user.email.split('@')[0], bName: other.split('@')[0], msgs: [], read: {} };
        if (th.a === user.email) th.aName = user.name || th.aName; else th.bName = user.name || th.bName;
        /* What it is about, kept on the thread so the other side sees "about
           Vintage jacket" rather than a message from a stranger with no context. */
        if (who.about && !th.about) th.about = who.about;
        th.msgs = th.msgs || [];
        th.msgs.push({ from: user.email, text: body, ts: Date.now() });
        if (th.msgs.length > 500) th.msgs = th.msgs.slice(-500);
        /* READ MARKERS ARE COUNTS, not timestamps.

           They were timestamps, and nothing ever compared them to anything, so
           "unread" could not be computed on the server at all - which is part of
           why the inbox was reading localStorage. A count of messages a person
           has seen is comparable to the length of the thread, which is the whole
           question. */
        th.read = th.read || {};
        if (typeof th.read[user.email] !== 'number' || th.read[user.email] > th.msgs.length) th.read[user.email] = 0;
        th.read[user.email] = th.msgs.length;    // the sender has seen their own message
        await env.AMV_KV.put(key, JSON.stringify(th));
        return th;
      });
  } catch (e) {
    /* Not written. Say so, because a message that silently did not send is the
       one failure this whole route exists to prevent. A fault inside the append
       is NOT the same thing and must not be dressed up as "try again". */
    if (!_isBusy(e)) throw e;
    audit(env, 'market_message_busy', { from: user.email, to: other });
    return json({ error: 'That conversation was busy for a moment and your message was not sent. Please send it again.', code: 'thread_busy' }, 503);
  }
  /* Both sides now know this conversation exists without anybody having to
     find it by listing every thread in the product. Written after the message
     is safely stored, and best-effort: an index that missed one entry costs a
     rebuild, and failing the send because a convenience index did not write
     would lose the thing that actually mattered. */
  await _inboxIndexAdd(env, user.email, key);
  await _inboxIndexAdd(env, other, key);
  audit(env, 'market_message', { from: user.email, to: other });

  /* TELL THEM TO COME AND READ IT - and send them nothing else.

     The message body does NOT travel. If it did, this endpoint would still be
     a way to deliver an attacker's words and links into somebody's inbox, and
     deriving the recipient above would have bought nothing. They get who, and
     a way back to AMV. Best-effort: a notification that fails must not fail
     the send, because the message IS delivered - it is in their inbox. */
  const noteCtx = { from: (user.name || String(user.email).split('@')[0]), to: other,
                    about: (who.about && who.about.title) || (t.about && t.about.title) || '' };
  try { await _notifyNewMessage(env, noteCtx); } catch (e) {}
  return json({ ok: true, thread: t });
}

/* "Somebody messaged you on AMV." Who, and a link. Never the message. */
async function _notifyNewMessage(env, { from, to, about }) {
  if (!env.EMAIL_API_KEY) return false;
  const appUrl = String(env.APP_URL || '').replace(/\/$/, '');
  const link = appUrl ? appUrl + '?tab=market&inbox=1' : '';
  const who = _escHtml(String(from || 'Someone').slice(0, 60));
  const item = about ? _escHtml(String(about).slice(0, 80)) : '';
  return _sendEmail_message(env, to, `${String(from || 'Someone').slice(0, 60)} sent you a message on AMV`,
    _emailShell('You have a new message',
      `<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#555"><b>${who}</b> sent you a message on AMV`
      + (item ? ` about <b>${item}</b>` : '') + '.</p>'
      + '<p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#555">Open AMV to read it and reply.</p>',
      link ? { label: 'Open your messages', url: link } : null,
      '<p style="margin:0;font-size:12px;line-height:1.6;color:#999">For your safety the message itself is not included in this email. '
      + 'Read it in AMV, where you can see who sent it and report anything that should not be there.</p>',
      'You received this because somebody messaged you on the AMV marketplace.'),
    `${String(from || 'Someone').slice(0, 60)} sent you a message on AMV`
    + (about ? ` about "${String(about).slice(0, 80)}"` : '') + '.\n\n'
    + 'Open AMV to read it and reply: ' + link + '\n\n'
    + 'For your safety the message itself is not included in this email.\n\n- The AMV team');
}

/* Opening a conversation clears its badge. Only for a thread you are in. */
async function marketThreadRead(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { thread } = await request.json().catch(() => ({}));
  const tid = String(thread || '');
  if (!tid) return json({ error: 'which conversation?' }, 400);
  /* Shaped like a thread key before it is used as one - the membership check
     below must not be the only thing standing between a caller-supplied
     string and a write to that name. */
  if (!_threadKeyOK(tid)) return json({ error: 'not found' }, 404);
  let t = null;
  try { const raw = await env.AMV_KV.get(tid); if (raw) t = JSON.parse(raw); } catch (e) {}
  if (!t) return json({ error: 'not found' }, 404);
  const me = String(user.email).toLowerCase();
  if (String(t.a || '').toLowerCase() !== me && String(t.b || '').toLowerCase() !== me)
    return json({ error: 'not your conversation' }, 403);
  t.read = t.read || {};
  t.read[me] = (t.msgs || []).length;
  await env.AMV_KV.put(tid, JSON.stringify(t));
  return json({ ok: true, unread: 0 });
}

/* List the current user's message threads (newest first). */
/* ONE PERSON'S CONVERSATIONS, WITHOUT LISTING EVERYBODY'S.

   A thread key encodes both participants - `mkthread:a@x.com__b@x.com` - so
   the inbox filtered on the key and avoided reading other people's threads.
   That is the cheap half. The expensive half is that it still LISTED every
   thread key in the product, on every inbox load, with no cap: the work grew
   with total conversations rather than with the caller's.

   The key shape also cannot be narrowed by prefix, because the pair is sorted
   - somebody whose address sorts second appears in the middle of the key and
   no prefix reaches them. So it is an index, built on first use like the
