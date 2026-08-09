/* (Every index here goes through a guard: this file's whole job is to report
   WHICH link of the delivery is broken, and a TypeError on a missing thread
   says none of that while silently skipping every assertion after it.)

   ASKING BEFORE BUYING, AND THE SELLER ACTUALLY GETTING IT.

   "Is this still available?" is the question that starts most marketplace
   sales. If it does not arrive, the sale does not happen and neither person
   ever learns why - the buyer sees their message sitting in a thread and
   assumes they were ignored.

   That is what was happening. The client kept threads in localStorage, fired
   the send at the server best-effort with the result discarded, and nothing
   anywhere ever asked the server for threads. So the message existed on the
   sender's own machine and in a record nobody read. The seller's inbox was
   their own empty localStorage. It looked like it worked from the one side
   that could see it.

   The shape it has to have instead is the one every marketplace uses: the
   message goes to the person's inbox ON AMV, and an email tells them to come
   and read it. Which means three things have to be true, and they are what
   this file is about.

   FIRST, the recipient is a person on AMV, resolved from a listing or a
   conversation that already exists - never an address somebody typed. An
   endpoint that delivers to any string is a way to put text in a stranger's
   inbox, and that is a spam service with AMV's name on the envelope.

   SECOND, the notification carries WHO and a LINK, and not the message. If
   the body travels by email then AMV is still the delivery mechanism for
   whatever an attacker writes - the restriction above buys nothing.

   THIRD, both sides read the same conversation from the server, because a
   thread only one person can see is not a conversation. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'inbox.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/resend|mail|sendgrid|postmark/i.test(u)) {
    emails.push({ url: u, body: String((opts && opts.body) || '') });
    return { ok: true, status: 200, json: async () => ({ id: 'e1' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra, readDelayMs = 0) {
  const m = new Map(); const vals = new Map(); emails = [];
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    EMAIL_API_KEY: 'k', SUPPORT_EMAIL: 'help@amv.test',
    AMV_KV: {
      _map: m,
      /* The value as it stood when the read was ISSUED, handed back after the
         delay - which is what a read is. Sleeping and then looking at the map
         would let a slow reader see a write that landed meanwhile, so two
         writers could never disagree and no race could be expressed. */
      async get(k) {
        const asServed = m.has(k) ? m.get(k) : null;
        if (readDelayMs) await new Promise(r => setTimeout(r, readDelayMs));
        return asServed;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        /* The lock primitive, modelled rather than waved through. A stub that
           answered every op with {allowed:true} returns no `claimed` field, so
           taking a lock would appear to FAIL - and a route that now writes
           under one would 503 on every call while the file still looked like
           it was testing messaging. */
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '55.55.55.55',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, path, body, tok) => {
  const r = await call(env, path, body, tok);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const PW = 'A-real-Passw0rd!';
const signup = async (env, email, name) =>
  (await (await call(env, '/auth/signup', { email, name, password: PW })).json()).token;

const BUYER = 'buyer@example.com';
const SELLER = 'seller@example.com';

async function twoPeopleAndAListing(env) {
  const buyer = await signup(env, BUYER, 'Bea');
  const seller = await signup(env, SELLER, 'Sam');
  const item = (await post(env, '/v1/market/publish',
    { title: 'Vintage jacket', text: 'the goods', price: 40 }, seller)).body.item;
  return { buyer, seller, item };
}

section('A buyer can ask a question before buying');
{
  const env = mkEnv();
  const { buyer, item } = await twoPeopleAndAListing(env);

  const sent = await post(env, '/v1/market/message', { item: item.id, text: 'Is this still available?' }, buyer);
  ok(sent.body.ok === true, 'the question is sent about a listing, without having bought it', sent.body.error || 'ok');
  const m0 = ((sent.body.thread || {}).msgs || [])[0];
  ok(((sent.body.thread || {}).msgs || []).length === 1,
     'and lands in a conversation', ((sent.body.thread || {}).msgs || []).length);
  ok(!!m0 && m0.from === BUYER, 'from whoever really sent it', m0 && m0.from);
}

section('And the SELLER can see it, which is the part that was missing');
{
  const env = mkEnv();
  const { buyer, seller, item } = await twoPeopleAndAListing(env);
  await post(env, '/v1/market/message', { item: item.id, text: 'Is this still available?' }, buyer);

  const theirs = await post(env, '/v1/market/threads', {}, seller);
  ok((theirs.body.threads || []).length === 1,
     'the conversation is in the seller’s inbox on the server', (theirs.body.threads || []).length);
  const t = (theirs.body.threads || [])[0] || {};
  ok(((t.msgs) || []).some(m => /still available/.test(m.text)),
     'carrying what was actually asked', ((t.msgs) || []).map(m => m.text));
  ok(t.unread >= 1, 'and marked unread for them, so they know somebody is waiting', t.unread);

  /* The sender's own copy is not unread - they wrote it. */
  const mine = await post(env, '/v1/market/threads', {}, buyer);
  ok((mine.body.threads[0] || {}).unread === 0, 'while the sender has nothing unread', (mine.body.threads[0] || {}).unread);
}

section('The reply lands in the SAME conversation, both ways');
{
  const env = mkEnv();
  const { buyer, seller, item } = await twoPeopleAndAListing(env);
  const a = await post(env, '/v1/market/message', { item: item.id, text: 'Still available?' }, buyer);
  const tid = (a.body.thread || {}).id;
  const b = await post(env, '/v1/market/message', { thread: tid, text: 'Yes it is' }, seller);
  ok(b.body.ok === true, 'the seller replies into the existing thread', b.body.error || 'ok');
  ok(!!b.body.thread && b.body.thread.id === tid, 'which is the same one', (b.body.thread || {}).id);
  ok(((b.body.thread || {}).msgs || []).length === 2, 'now holding both sides', ((b.body.thread || {}).msgs || []).length);

  const back = await post(env, '/v1/market/threads', {}, buyer);
  const bt = (back.body.threads || [])[0] || {};
  ok((bt.msgs || []).length === 2, 'and the buyer sees the reply', (bt.msgs || []).length);
  ok(bt.unread === 1, 'unread for them now', bt.unread);

  const opened = await post(env, '/v1/market/thread/read', { thread: tid }, buyer);
  ok(opened.body.ok === true, 'opening it clears the badge', opened.body.error || 'ok');
  const after = await post(env, '/v1/market/threads', {}, buyer);
  ok(((after.body.threads || [])[0] || {}).unread === 0, 'and it stays cleared', ((after.body.threads || [])[0] || {}).unread);
}

section('They are told by email to come and read it - and the email carries no message');
{
  const env = mkEnv();
  const { buyer, item } = await twoPeopleAndAListing(env);
  await post(env, '/v1/market/message', { item: item.id, text: 'SECRETPAYLOAD click bit.ly/evil' }, buyer);
  await ctx.settle();

  ok(emails.length === 1, 'exactly one notification went out', emails.length);
  const blob = emails.map(e => e.body).join(' ');
  ok(/seller@example\.com/.test(blob), 'to the seller', true);
  ok(/Bea|buyer@example\.com/.test(blob), 'naming who messaged them', true);
  ok(/amv\.test/.test(blob), 'with a link back to AMV', true);
  /* The whole point. If the body travels, AMV is a way to put an attacker's
     words and links into somebody's inbox, and restricting the recipient buys
     nothing. */
  ok(!/SECRETPAYLOAD/.test(blob), 'and NOT the message itself', blob.slice(0, 200));
  ok(!/bit\.ly/.test(blob), 'so it cannot carry a link somebody else chose', true);
}

section('Nobody can message an address that is not a person on AMV');
{
  const env = mkEnv();
  const { buyer } = await twoPeopleAndAListing(env);

  const stranger = await post(env, '/v1/market/message', { to: 'victim@elsewhere.com', text: 'hello' }, buyer);
  ok(stranger.status >= 400, 'a typed address that is not an account is refused', stranger.status);
  await ctx.settle();
  ok(emails.length === 0, 'and no email is sent to them, at all', emails.length);
}

section('And not through a listing or thread that is not theirs to use');
{
  const env = mkEnv();
  const { buyer } = await twoPeopleAndAListing(env);
  /* A second buyer and a second listing, in THIS env, so the conversation they
     start is one the outsider below can actually try to reach. */
  const buyer2 = await signup(env, 'buyer2@example.com', 'Bo');
  const seller2 = await signup(env, 'seller2@example.com', 'Sid');
  const item2 = (await post(env, '/v1/market/publish',
    { title: 'Second thing', text: 'goods', price: 12 }, seller2)).body.item;
  const env2 = () => env;
  const gone = await post(env, '/v1/market/message', { item: 'usr_doesnotexist', text: 'hi' }, buyer);
  ok(gone.status >= 400, 'a listing that does not exist is refused', gone.status);

  /* A REAL conversation between two other people. The first version of this
     named a thread that did not exist, so it was refused at "no such
     conversation" and the membership check was never reached - the guard could
     be deleted entirely and this still passed. The interesting case is a
     thread that IS there and is not yours. */
  const real = await post(env, '/v1/market/message', { item: item2.id, text: 'Hello there' }, buyer2);
  const liveThread = (real.body.thread || {}).id;
  ok(!!liveThread, 'a real conversation exists between two other people', liveThread);

  const outsider = await signup(env, 'nosy@example.com', 'Nosy');
  const notMine = await post(env, '/v1/market/message', { thread: liveThread, text: 'butting in' }, outsider);
  ok(notMine.status === 403, 'and somebody outside it cannot write into it', notMine.status);

  const stillTwo = await post(env, '/v1/market/threads', {}, buyer2);
  ok((((stillTwo.body.threads || [])[0] || {}).msgs || []).length === 1,
     'with the conversation untouched', (((stillTwo.body.threads || [])[0] || {}).msgs || []).length);
}

section('Messaging yourself, or nothing at all, is still refused');
{
  const env = mkEnv();
  const { seller, item } = await twoPeopleAndAListing(env);
  const self = await post(env, '/v1/market/message', { item: item.id, text: 'hi' }, seller);
  ok(self.status >= 400, 'the seller cannot start a conversation with themselves', self.body);
  const empty = await post(env, '/v1/market/message', { item: item.id, text: '   ' }, seller);
  ok(empty.status >= 400, 'and an empty message is refused', empty.status);
}

section('A stranger cannot read anybody’s inbox');
{
  const env = mkEnv();
  const { buyer, item } = await twoPeopleAndAListing(env);
  await post(env, '/v1/market/message', { item: item.id, text: 'Still available?' }, buyer);

  const nobody = await post(env, '/v1/market/threads', {});
  ok(nobody.status === 401, 'not without an account', nobody.status);

  const outsider = await signup(env, 'nosy2@example.com', 'Nosy');
  const theirs = await post(env, '/v1/market/threads', {}, outsider);
  ok((theirs.body.threads || []).length === 0,
     'and somebody else’s conversation is not in their inbox', (theirs.body.threads || []).length);
}

section('Two people replying at the same moment both get through');
{
  /* A thread has two writers by definition, and it was read, appended to, and
     written back with nothing holding it. Both replying in the same second read
     the same conversation and both write it, so one message is simply gone -
     no error, and the sender keeps seeing it in their own copy. They find out
     it never arrived when the other person answers something else, or never
     answers at all.

     The store here hands back the value as it stood when the read was issued,
     so the two really do disagree. Without that this passes with no lock at
     all. */
  const env = mkEnv(null, 12);
  const { buyer, seller, item } = await twoPeopleAndAListing(env);
  await post(env, '/v1/market/message', { item: item.id, text: 'is it still available' }, buyer);
  /* The seller replies through the conversation, not through their own
     listing - which is how the product works, and the only way the two writers
     are the two people in the thread. */
  const seen = await post(env, '/v1/market/threads', {}, seller);
  const tid = ((seen.body.threads || [])[0] || {}).id;
  ok(!!tid, 'the seller can see the conversation', tid);

  const [a, b] = await Promise.all([
    post(env, '/v1/market/message', { item: item.id, text: 'BUYER SAYS TOMORROW' }, buyer),
    post(env, '/v1/market/message', { thread: tid, text: 'SELLER SAYS YES' }, seller),
  ]);
  ok(a.body.ok === true && b.body.ok === true, 'neither send was refused',
     { buyer: a.body.error || 'ok', seller: b.body.error || 'ok' });

  const inbox = await post(env, '/v1/market/threads', {}, seller);
  const thread = (inbox.body.threads || [])[0] || {};
  const texts = (thread.msgs || []).map(m => m.text);
  ok(texts.includes('BUYER SAYS TOMORROW'), 'the buyer’s message is in the conversation', texts);
  ok(texts.includes('SELLER SAYS YES'), 'and so is the seller’s', texts);
  ok(texts.length === 3, 'three messages were sent and three are there', texts.length);
}

section('A send that cannot take the lock is reported, not swallowed');
{
  /* The failure that would replace the old one: a message that did not send,
     answered with ok. The person walks away believing it was delivered, which
     is worse than being told to send it again. */
  const env = mkEnv(null, 12);
  const { buyer, seller, item } = await twoPeopleAndAListing(env);
  await post(env, '/v1/market/message', { item: item.id, text: 'first' }, buyer);

  /* Hold the thread's lock so the send cannot take it. */
  const held = await post(env, '/v1/market/threads', {}, buyer);
  const tid = ((held.body.threads || [])[0] || {}).id;
  ok(!!tid, 'the conversation exists to be locked', tid);
  /* The name _claimOnce builds, so holding it here is the same lock the route
     will try to take rather than a lookalike. */
  const lock = 'claim:rmut:mktthread:' + String(tid).toLowerCase();
  const taken = await (await env.AMV_COUNTER.get(lock).fetch('https://do/counter',
    { method: 'POST', body: JSON.stringify({ op: 'claim', ttlMs: 15000 }) })).json();
  ok(taken.claimed === true, 'the lock is held before the send is attempted', taken);

  const r = await post(env, '/v1/market/message', { item: item.id, text: 'second' }, buyer);
  ok(r.body.ok !== true, 'it is not reported as sent', r.body);
  ok(r.status === 503 && r.body.code === 'thread_busy', 'it says the conversation was busy', { status: r.status, code: r.body.code });
  ok(/send it again|not sent/i.test(r.body.error || ''), 'and tells them to send it again', r.body.error);

  const after = await post(env, '/v1/market/threads', {}, buyer);
  const texts = (((after.body.threads || [])[0] || {}).msgs || []).map(m => m.text);
  ok(!texts.includes('second'), 'and the message really is not in the conversation', texts);
}

globalThis.fetch = realFetch;
if (report('a-message-reaches-the-other-person') > 0) process.exitCode = 1;
done();
