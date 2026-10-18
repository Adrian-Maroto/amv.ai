/* =====================================================================
   MARKETPLACE (auditor #12) - community template store.
   Templates are stored as market:<id>; install counts rank them. Publishing
   requires auth (so submissions are attributable + moderatable). This is the
   technical substrate for the network effect - it lights up as real users
   publish and install.
   ===================================================================== */
/* THE CATALOGUE, WHICH ANYBODY CAN ASK FOR.

   This walked every `market:` key and did a full read of each one, on a PUBLIC
   unauthenticated route, with no cache. One HTTP request from anybody at all
   turned into one storage read per listing in the product. That is a bill and
   a way to generate load, and it grew with every listing anybody published.

   The bound it had was worse than none: `while (cursor && out.length < 500)`
   counts VISIBLE results, so a catalogue of a hundred thousand hidden or
   removed listings and ten active ones read all hundred thousand. And it
   sorted by installs AFTER stopping, so "most popular" was the most popular of
   whichever listings happened to come first in KEY order - the same defect
   already found and fixed in the payouts screen, still here on the page every
   visitor sees.

   So: one snapshot, built at most once a minute and shared by everybody who
   asks. The bound is on KEYS READ rather than on results kept, which is the
   only version of it that bounds the work. Publishing or removing a listing
   clears it, because a seller not seeing their own new listing is the thing
   people actually notice; anything else is a minute stale, which a catalogue
   can be. */
const MARKET_CACHE_KEY = 'mktcache:v1';
const MARKET_CACHE_TTL_S = 60;
const MARKET_LIST_MAX = 500;      // items returned
/* A rebuild in flight in this isolate, so eight simultaneous visitors do not
   start eight full reads of the store. Module scope on purpose: an isolate is
   exactly the scope that serves concurrent requests. */
let _mktBuilding = null;

async function _marketCacheBust(env) {
  try { await env.AMV_KV.delete(MARKET_CACHE_KEY); } catch (e) { /* stale for a minute is survivable */ }
  /* And release the rebuild claim, or a publish clears the snapshot and the
     next request finds no copy AND no permission to build one. */
  try { await _releaseClaim(env, 'mktbuild', 'snapshot'); } catch (e) {}
  /* AND the in-flight build, which is the subtle one. A build that started
     BEFORE this publish will not contain the new listing, and a request
     arriving now would join it and be handed a catalogue that is already
     wrong - the seller looks straight at the marketplace and does not find
     what they just published. Dropping the handle means the next request
     starts a fresh build; the old one still finishes and writes, and is
     immediately superseded. */
  _mktBuilding = null;
}

async function _marketSnapshot(env) {
  const items = [];
  let cursor, scanned = 0, truncated = false;
  do {
    const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
    for (const k of (page.keys || [])) {
      scanned++;
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try {
        const it = JSON.parse(raw);
        if (!it.hidden && (!it.status || it.status === 'active') && !(it.plugin && _mktPluginScan(it.plugin).refuse)) items.push(_publicListing(it));
      } catch (e) {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
    if (cursor && scanned >= MKT_SCAN_MAX) { truncated = true; break; }
  } while (cursor);
  /* Ranked across everything that was read, then cut - rather than cut in
     arbitrary key order and ranked within that. */
  items.sort((a, b) => (b.installs || 0) - (a.installs || 0));
  return { items: items.slice(0, MARKET_LIST_MAX), scanned, truncated, at: Date.now() };
}

async function marketList(request, env) {
  // public: active community listings, most installed first
  let snap = null;
  try {
    const raw = await env.AMV_KV.get(MARKET_CACHE_KEY);
    if (raw) snap = JSON.parse(raw);
  } catch (e) { snap = null; }   // an unreadable cache is a miss, not a failure

  const fresh = snap && Array.isArray(snap.items) && (Date.now() - (+snap.at || 0) < MARKET_CACHE_TTL_S * 1000);

  if (!fresh) {
    /* ONE REBUILD AT A TIME, AND NOBODY WAITS FOR IT.

       The snapshot expiring is the busiest moment this route has: every
       request in flight misses at once and every one of them rebuilds, so a
       catalogue that costs one full read per minute costs one per CONCURRENT
       VISITOR instead - and the worse the traffic, the worse the multiplier.
       That is a thundering herd, and a cache is what caused it.

       So the rebuild is claimed. Whoever gets the claim does the work; anybody
       else serves the copy they already have, which is seconds stale on a
       catalogue and not worth a full store read to avoid. Only a caller who
       has NO copy at all - the very first request after a deploy - waits for a
       build, because there is nothing honest to hand back.

       The snapshot is now stored without a TTL and judged by its own
       timestamp. Under a TTL there is no stale copy to serve at the exact
       moment one is needed. */
    const noCopy = !snap || !Array.isArray(snap.items);
    /* CLAIMED WITHOUT AWAITING FIRST.

       The first version asked _claimOnce before setting this, and every one of
       eight simultaneous visitors passed the claim - because `await` yields,
       so all eight got their answer before any of them had marked a build as
       running. The guard has to be taken SYNCHRONOUSLY, in the same turn as
       the check, or it is not a guard at all.

       That is why the assignment below sits directly under the test with no
       await between them. */
    if (!_mktBuilding) {
      _mktBuilding = (async () => {
        const built = await _marketSnapshot(env);
        try { await env.AMV_KV.put(MARKET_CACHE_KEY, JSON.stringify(built)); } catch (e) { /* uncached is slow, not broken */ }
        return built;
      })();
      /* Cleared when it settles, not here - anybody arriving meanwhile should
         join THIS build rather than start another. */
      _mktBuilding.then(() => { _mktBuilding = null; }, () => { _mktBuilding = null; });
    }
    /* Somebody holding a stale copy serves it and does not wait: seconds of
       staleness on a catalogue is not worth a full store read to avoid.
       Somebody with nothing waits for the build already in flight. */
    if (noCopy) { try { snap = await _mktBuilding; } catch (e) { snap = null; } }
  }

  return json({ ok: true, items: snap.items,
    /* A catalogue that stopped short says so, in the answer, rather than
       presenting a slice as the whole store. */
    truncated: snap.truncated || undefined,
    scanned: snap.truncated ? snap.scanned : undefined,
    note: snap.truncated
      ? 'There are more listings than this view reads in one pass, so this is the most installed of what it reached. Search to find a specific one.'
      : undefined });
}

