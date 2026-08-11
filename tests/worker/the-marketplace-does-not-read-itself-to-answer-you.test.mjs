/* THREE PAGES THAT READ THE WHOLE STORE TO ANSWER ONE QUESTION.

   Each of these worked, and each got more expensive every time anybody else
   used the product:

     marketMyListings  walked every listing key and did a FULL READ of each
                       one, keeping the handful whose author matched. A seller
                       opening their own page to see their three items read
                       every item in the marketplace. No cap at all.

     marketList        the same walk, on a PUBLIC unauthenticated route with no
                       cache - one HTTP request from anybody turned into one
                       storage read per listing in the product. Its bound was
                       worse than none: `out.length < 500` counts VISIBLE
                       results, so a catalogue of a hundred thousand removed
                       listings and ten live ones read all hundred thousand.
                       And it sorted by installs AFTER stopping, so "most
                       popular" was the most popular of whichever listings came
                       first in KEY order - the same defect already found and
                       fixed on the payouts screen, still on the page every
                       visitor sees.

     marketThreads     listed every conversation key in the product on every
                       inbox load. Cheaper per key, because the participants
                       are in the key so other people's threads were not read -
                       but still unbounded, and growing with total
                       conversations rather than with the caller's.

   None of this shows up in a test that checks the page returns the right
   items, because it does. It shows up in the bill, and in a page that is fine
   in testing and unusable at forty thousand listings. So what is measured here
   is the WORK: how many storage operations one caller causes, against a store
   big enough for the difference to be unmistakable.

   The rule these settle on: a page answers from an index of the caller's own
   things, or from a shared snapshot - never by reading everybody's records and
   discarding the ones that are not yours. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'mktscale.harness.mjs');
writeFileSync(harness, src +
  '\nexport { marketList, marketMyListings, marketThreads, marketUnlist, marketPublish, marketMessage, _sellerListingIds, _sellerIndexAdd, _sellerIndexRemove,' +
  ' _inboxThreadKeys, _marketCacheBust, MARKET_CACHE_KEY, MKT_SCAN_MAX, requireUser, signToken, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

/* A store that counts what is asked of it, which is the entire point. */
const store = new Map();
let reads = 0, lists = 0;
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { reads++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor, limit }) {
      lists++;
      const all = [...store.keys()].filter(k => k.startsWith(prefix || '')).sort();
      const start = cursor ? all.indexOf(cursor) + 1 : 0;
      const slice = all.slice(start, start + (limit || 1000));
      const last = slice[slice.length - 1];
      const complete = start + slice.length >= all.length;
      return { keys: slice.map(name => ({ name })), list_complete: complete, cursor: complete ? undefined : last };
    },
  },
};
const meter = () => { reads = 0; lists = 0; };

const MINE = 'seller@x.com';
const OTHERS = 400;                 // other people's listings, which are not the caller's business
function seedCatalogue() {
  store.clear();
  for (let i = 0; i < OTHERS; i++) {
    const id = 'other' + String(i).padStart(4, '0');
    store.set('market:' + id, JSON.stringify({
      id, title: 'Thing ' + i, authorEmail: 'someone' + i + '@x.com',
      status: 'active', installs: i, price: 5, createdAt: 1000 + i,
    }));
  }
  ['mine1', 'mine2', 'mine3'].forEach((id, n) => {
    store.set('market:' + id, JSON.stringify({
      id, title: 'Mine ' + n, authorEmail: MINE,
      status: 'active', installs: 1000 + n, price: 5, createdAt: 9000 + n,
    }));
  });
}

async function tokenFor(email) {
  store.set('acct:' + email, JSON.stringify({ email }));
  return (await W.issueTokens(env, email, 'X')).token;
}
const asUser = async (path, email) => new Request('https://w' + path, {
  headers: { Authorization: 'Bearer ' + (await tokenFor(email)) },
});

section('A seller sees their own listings without reading everybody else’s');
{
  seedCatalogue();
  /* The first load is the one-time backfill - the old behaviour, once, to seed
     an index for listings that predate it. It is allowed to be expensive. */
  const first = await W.marketMyListings(await asUser('/v1/market/mine', MINE), env);
  const d1 = await first.json();
  ok(d1.items.length === 3, 'the backfill finds exactly their three listings', d1.items.map(i => i.id));
  ok(!d1.items.some(i => i.authorEmail !== MINE), 'and nobody else’s', true);

  meter();
  const again = await W.marketMyListings(await asUser('/v1/market/mine', MINE), env);
  const d2 = await again.json();
  ok(d2.items.length === 3, 'the second load returns the same three', d2.items.map(i => i.id));
  /* THE MEASUREMENT. Before: 403 gets and a full listing walk. After: the
     index, their three records, and the account reads requireUser does. */
  ok(reads < 20,
     'and costs a handful of reads rather than one per listing in the store', { reads, catalogue: OTHERS + 3 });
  ok(lists === 0, 'with no store-wide listing at all', lists);
}

section('Publishing keeps the index true, so the next load stays cheap');
{
  /* An index that is only ever built by a backfill is a cache that goes stale
     the first time somebody publishes - and the failure is invisible: their
     new listing simply is not on their page. */
  const idx = await W._sellerListingIds(env, MINE);
  ok(idx.ids.length === 3, 'three, before', idx.ids);
  /* Through the ROUTE, not the helper. Calling _sellerIndexAdd directly here
     proved the helper works and said nothing about whether publishing calls
     it - and a sabotage that deleted the call from marketPublish passed. The
     wiring is the thing that breaks. */
  const pub = await W.marketPublish(new Request('https://w/v1/market/publish', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await tokenFor(MINE)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'A fourth thing', kind: 'prompt', price: 0, text: 'Some useful instructions.' }),
  }), env);
  const pd = await pub.json();
  ok(pub.status === 200 && pd.item && pd.item.id, 'publishing works', pd);
  meter();
  const r = await W.marketMyListings(await asUser('/v1/market/mine', MINE), env);
  const d = await r.json();
  ok(d.items.length === 4, 'four, after, without another walk', d.items.map(i => i.id));
  ok(lists === 0, 'and still no store-wide listing', lists);
  ok(d.items.some(i => i.title === 'A fourth thing'),
     'and the listing they just published is on their page', d.items.map(i => i.title));
}

section('Removing one takes it out of the index too');
{
  const before = await W._sellerListingIds(env, MINE);
  ok(before.ids.length === 4, 'four to start with', before.ids);
  const doomed = before.ids.find(x => !['mine1', 'mine2', 'mine3'].includes(x));
  /* Through the route again, for the same reason. */
  const un = await W.marketUnlist(new Request('https://w/v1/market/unlist', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await tokenFor(MINE)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: doomed }),
  }), env);
  ok(un.status === 200, 'removing it works', un.status);
  const after = await W._sellerListingIds(env, MINE);
  ok(!after.ids.includes(doomed), 'and it leaves the index with the record', after.ids);

  /* An id whose record has vanished must not break the page - a removal can
     race a read, and an index is a convenience rather than the truth. */
  await W._sellerIndexAdd(env, MINE, 'ghost');
  const r = await W.marketMyListings(await asUser('/v1/market/mine', MINE), env);
  const d = await r.json();
  ok(r.status === 200 && d.items.length === 3,
     'a dangling id is skipped rather than shown or thrown', d.items.map(i => i.id));
}

section('The catalogue is read once a minute, not once a visitor');
{
  seedCatalogue();
  await W._marketCacheBust(env);
  meter();
  await W.marketList(new Request('https://w/v1/market/list'), env);
  const cold = reads;
  ok(cold > OTHERS, 'the first request builds the snapshot, which does read them', cold);

  meter();
  for (let i = 0; i < 5; i++) await W.marketList(new Request('https://w/v1/market/list'), env);
  ok(reads <= 5,
     'and five more visitors cost one read each, not one per listing each', { reads, wouldHaveBeen: cold * 5 });
}

section('Publishing clears it, because a seller looks straight at the catalogue');
{
  /* Driven through the route. Calling _marketCacheBust here proved the helper
     deletes a key and said nothing about whether publishing calls it - and
     with a sixty-second cache, the failure is a seller publishing a listing
     and not finding it in the marketplace, which is the first thing anybody
     does after publishing. */
  await W.marketList(new Request('https://w/v1/market/list'), env);   // warm
  ok(store.has(W.MARKET_CACHE_KEY), 'the snapshot is stored', true);

  const pub = await W.marketPublish(new Request('https://w/v1/market/publish', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await tokenFor('fresh@x.com')), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Brand new right now', kind: 'prompt', price: 0, text: 'Instructions.' }),
  }), env);
  ok(pub.status === 200, 'a new listing is published', pub.status);
  const d = await (await W.marketList(new Request('https://w/v1/market/list'), env)).json();
  ok(d.items.some(i => i.title === 'Brand new right now'),
     'and it is in the catalogue on the very next request', d.items.length);
}

section('The ranking is over everything read, not over an arbitrary slice');
{
  /* The failure this replaces: sorting AFTER stopping meant the top of the
     catalogue was the most-installed of whatever came first in key order.
     Here the most installed listings sort LAST by key, so a slice-then-sort
     cannot produce them. */
  store.clear();
  for (let i = 0; i < 50; i++) {
    const id = 'aaa' + String(i).padStart(3, '0');
    store.set('market:' + id, JSON.stringify({ id, title: 'early', authorEmail: 'a@x.com', status: 'active', installs: 1 }));
  }
  ['zzz1', 'zzz2'].forEach((id, n) => {
    store.set('market:' + id, JSON.stringify({ id, title: 'popular', authorEmail: 'a@x.com', status: 'active', installs: 9000 + n }));
  });
  await W._marketCacheBust(env);
  const d = await (await W.marketList(new Request('https://w/v1/market/list'), env)).json();
  ok(d.items[0] && d.items[0].installs >= 9000,
     'the most installed listing is first even though its key sorts last', d.items[0]);
}

section('Hidden and removed listings do not consume the visible budget');
{
  /* The old bound counted results kept, so the store could be full of
     listings nobody may see and every one of them was still read before the
     count moved. What bounds the work is keys READ. */
  ok(typeof W.MKT_SCAN_MAX === 'number' && W.MKT_SCAN_MAX > 0,
     'there is a bound, and it is on keys', W.MKT_SCAN_MAX);
  const snapFn = src.slice(src.indexOf('async function _marketSnapshot('),
                           src.indexOf('async function marketList('));
  ok(/scanned >= MKT_SCAN_MAX/.test(snapFn), 'the loop stops on keys scanned', true);
  ok(!/out\.length < 500/.test(snapFn) && !/items\.length < 500/.test(snapFn),
     'and not on how many survived the filter', true);

  store.clear();
  for (let i = 0; i < 200; i++) {
    const id = 'dead' + String(i).padStart(4, '0');
    store.set('market:' + id, JSON.stringify({ id, authorEmail: 'a@x.com', status: 'removed', installs: 5 }));
  }
  store.set('market:live1', JSON.stringify({ id: 'live1', authorEmail: 'a@x.com', status: 'active', installs: 1 }));
  await W._marketCacheBust(env);
  const d = await (await W.marketList(new Request('https://w/v1/market/list'), env)).json();
  ok(d.items.length === 1 && d.items[0].id === 'live1',
     'a store full of removed listings still shows the one live one', d.items);
}

section('An inbox costs the caller’s conversations, not everybody’s');
{
  store.clear();
  const ME = 'me@x.com';
  for (let i = 0; i < 300; i++) {
    store.set(`mkthread:other${i}@x.com__zz${i}@x.com`,
      JSON.stringify({ id: 'x', a: `other${i}@x.com`, b: `zz${i}@x.com`, msgs: [{ ts: i }], read: {} }));
  }
  const mineKeys = ['mkthread:a@x.com__me@x.com', 'mkthread:me@x.com__z@x.com'];
  mineKeys.forEach((k, n) => store.set(k, JSON.stringify({
    id: k, a: k.split('__')[0].slice(9), b: k.split('__')[1], msgs: [{ from: 'a@x.com', text: 'hi', ts: 100 + n }], read: {},
  })));

  const firstIdx = await W._inboxThreadKeys(env, ME);
  ok(firstIdx.ids.length === 2, 'the backfill finds both of their conversations', firstIdx.ids);

  meter();
  const r = await W.marketThreads(await asUser('/v1/market/threads', ME), env);
  const d = await r.json();
  ok(r.status === 200, 'the inbox loads', r.status);
  ok(lists === 0, 'without listing every conversation in the product', lists);
  ok(reads < 12, 'and reads only what is theirs', { reads, threads: 302 });
}

section('Sending a message indexes it for BOTH people, without a backfill');
{
  /* Through the route. The section above proves the index answers an inbox
     once it exists; this is the part that keeps it existing, and a sabotage
     that dropped the recipient's half passed until this was written - the
     seller would simply never see the message, and only on a fresh account
     where no backfill had run to cover for it. */
  store.clear();
  const SELLER = 'sells@x.com', BUYER = 'buys@x.com';
  const pub = await W.marketPublish(new Request('https://w/v1/market/publish', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await tokenFor(SELLER)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'A listing to ask about', kind: 'prompt', price: 0, text: 'Instructions.' }),
  }), env);
  const listing = (await pub.json()).item;
  ok(pub.status === 200 && listing && listing.id, 'there is something to message about', listing && listing.id);

  const sent = await W.marketMessage(new Request('https://w/v1/market/message', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await tokenFor(BUYER)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: listing.id, text: 'Is this still available?' }),
  }), env);
  ok(sent.status === 200, 'the message sends', sent.status);

  /* Both indexes exist NOW - built by the send, not by a scan afterwards. */
  const sellerIdx = JSON.parse(store.get('mktinbox:' + SELLER) || 'null');
  const buyerIdx = JSON.parse(store.get('mktinbox:' + BUYER) || 'null');
  ok(sellerIdx && sellerIdx.ids.length === 1, 'the seller’s inbox knows about it', sellerIdx);
  ok(buyerIdx && buyerIdx.ids.length === 1, 'and so does the sender’s', buyerIdx);

  meter();
  const inbox = await W.marketThreads(await asUser('/v1/market/threads', SELLER), env);
  const d = await inbox.json();
  ok(lists === 0, 'so the seller’s inbox needs no scan at all', lists);
  ok(JSON.stringify(d).includes('Is this still available?'),
     'and the message is in it', inbox.status);
}

section('The index is a convenience, never an authorization');
{
  /* A wrong entry in an index must not become a way to read somebody else's
     conversation. Membership is re-checked against the record. */
  const ME = 'me@x.com';
  store.set('mktinbox:' + ME, JSON.stringify({
    ids: ['mkthread:a@x.com__me@x.com', 'mkthread:other0@x.com__zz0@x.com'], built: Date.now(),
  }));
  const d = await (await W.marketThreads(await asUser('/v1/market/threads', ME), env)).json();
  const ids = (d.threads || d.items || []).map(t => t.id || '');
  ok(!JSON.stringify(d).includes('zz0@x.com'),
     'a thread they are not in is refused even when the index names it', ids);
}

if (report('the-marketplace-does-not-read-itself-to-answer-you') > 0) process.exitCode = 1;
done();
