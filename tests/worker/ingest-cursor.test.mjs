/* THE DIGEST THAT REPORTED THE SAME EMAIL EVERY DAY.

   `_autoAccountContext` asked Gmail for the newest 25 INBOX messages on every
   scheduled run, unconditionally, and handed all of them to the model. Two
   things followed, and the second is the one that actually costs somebody
   something:

     1. A daily job reported the SAME message every day until it fell out of
        the top 25 - so "what needs a reply" answered with yesterday's answer,
        and the person learned to skim it.
     2. If more than 25 arrived between runs, the older ones were never seen,
        and nothing recorded that they had been missed. The run read as
        complete. An inbox digest silently reporting on a fraction of the
        inbox is indistinguishable from an inbox with nothing else in it.

   This drives the REAL `_autoAccountContext` against a fake Gmail and a real
   KV, because the whole question is whether state written by one run is read
   by the next. A unit test of the filter would have been green for every
   version of this, including the one with no persistence at all.

   The rule the assertions are shaped around: every failure here must fall
   towards REPEATING a message, never towards dropping one. A repeat is
   annoying. A drop is somebody missing mail while AMV reports success. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ingest.harness.mjs');
writeFileSync(harness, src + `
export { _autoAccountContext, _fetchGmailHeads, runDueAutomations, INGEST_SEEN_MAX, INGEST_SRC_MAIL };
export function __setConnUse(fn){ connUse = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const EMAIL = 'reader@test.com';
const store = new Map();
const env = {
  JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx',
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  }
};

/* The connection is always available. This suite is about what happens AFTER
   the mailbox opens; `connUse` refusing has its own coverage. */
W.__setConnUse(async () => ({ ok: true, token: 'tok' }));

/* A fake Gmail that honours `after:` the way the real one does, so the query
   this code builds is actually exercised rather than assumed. */
let INBOX = [];
let lastQuery = null;
const realFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!/googleapis\.com$/.test(u.hostname)) {
    /* Anything that is not Gmail is the model. Answered rather than refused,
       because the section at the bottom drives the whole cron path and a run
       that throws would never reach the commit - which is the thing being
       tested. */
    modelCalls++;
    return new Response(JSON.stringify({ content: [{ text: 'a digest' }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
  }
  if (u.pathname.endsWith('/messages')) {
    lastQuery = u.searchParams.get('q');
    const max = Number(u.searchParams.get('maxResults')) || 25;
    const q = lastQuery || '';
    /* BOTH bounds, because the backfill is the half that only works if
       `before:` is honoured - a fake that quietly ignores it returns the same
       newest page and the reconciliation looks like it works when it does
       nothing. That is exactly what happened on the first run of this suite. */
    const m = /after:(\d+)/.exec(q);
    const b = /before:(\d+)/.exec(q);
    const afterMs = m ? Number(m[1]) * 1000 : 0;
    const beforeMs = b ? Number(b[1]) * 1000 : Infinity;
    const hits = INBOX
      .filter(x => x.occurred_at > afterMs && x.occurred_at < beforeMs)
      .sort((a, b) => b.occurred_at - a.occurred_at)   /* newest first, as Gmail does */
      .slice(0, max)
      .map(x => ({ id: x.id }));
    return new Response(JSON.stringify({ messages: hits }), { status: 200 });
  }
  const id = decodeURIComponent(u.pathname.split('/').pop());
  const msg = INBOX.find(x => x.id === id);
  if (!msg) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify({
    id: msg.id, internalDate: String(msg.occurred_at), snippet: msg.snippet || '',
    labelIds: ['INBOX'].concat(msg.unread ? ['UNREAD'] : []),
    payload: { headers: [{ name: 'From', value: msg.from }, { name: 'Subject', value: msg.subject },
                         { name: 'Date', value: new Date(msg.occurred_at).toUTCString() }] }
  }), { status: 200 });
};

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
const mail = (n, at) => ({ id: 'm' + n, occurred_at: at, from: 'sender' + n + '@x.com',
                           subject: 'Subject ' + n, snippet: 'preview ' + n, unread: true });

const JOB = { id: 'j1', uses: ['mail.read'] };
/* One run, end to end: gather the context, then commit as the cron does once
   the result is durable. `commit:false` is a run that produced nothing. */
const run = async (opts) => {
  const r = await W._autoAccountContext(env, JOB, EMAIL);
  if (!opts || opts.commit !== false) await r.commit();
  return r;
};
const listed = (text) => (text.match(/^- /gm) || []).length;

section('The first run has no memory, and reports what is there');
{
  INBOX = [mail(1, T0), mail(2, T0 + 1000), mail(3, T0 + 2000)];
  const r = await run();
  ok(listed(r.text) === 3, 'all three are reported', r.text);
  ok(!/NEW SINCE/.test(r.text), 'and it is not described as new since a run that never happened', r.text);
  ok(lastQuery === null, 'nothing is asked for after a cursor there is no value for', lastQuery);
}

section('The second run reports nothing, and says so in those words');
{
  const r = await run();
  ok(listed(r.text) === 0, 'no message is reported twice - this is the whole defect', r.text);
  ok(/nothing has arrived since the last run/i.test(r.text),
     'and the model is told it is "nothing new", NOT an empty inbox', r.text);
  ok(/does NOT mean the inbox is empty/i.test(r.text),
     'in words, because a model handed an empty list picks whichever reads better', r.text);
  ok(/after:\d+/.test(lastQuery || ''), 'and the fetch now asks Gmail for the window it needs', lastQuery);
}

section('A new message is reported, and only that one');
{
  INBOX.push(mail(4, T0 + 60_000));
  const r = await run();
  ok(listed(r.text) === 1 && /Subject 4/.test(r.text), 'the new one, and nothing else', r.text);
  ok(/NEW SINCE AMV LAST LOOKED/.test(r.text), 'framed as what changed', r.text);

  const again = await run();
  ok(listed(again.text) === 0, 'and it is not reported again on the next run', again.text);
}

section('The overlap window drags old mail back, and dedup removes it');
{
  /* The fetch deliberately reaches back BEFORE the cursor, because an exact
     boundary is how one message falls between two runs. That only works if the
     duplicates it pulls in are then filtered - otherwise the overlap IS the
     duplicate-reporting bug in a smaller form. */
  const before = INBOX.length;
  const r = await run();
  ok(/after:\d+/.test(lastQuery || ''), 'the query reaches back past the cursor', lastQuery);
  const asked = Number(/after:(\d+)/.exec(lastQuery)[1]) * 1000;
  ok(asked < T0 + 60_000, 'strictly earlier than the newest message already reported', { asked });
  ok(listed(r.text) === 0, 'and nothing it drags back in is reported a second time', r.text);
  ok(INBOX.length === before, 'the fake inbox was not disturbed', INBOX.length);
}

section('A burst bigger than one page is still reported in full');
{
  /* 25 is the page. Thirty arrive between runs: Gmail hands back the newest 25
     and the five older ones are invisible to `after:` for ever, because the
     answer is newest-first. The reconciliation pass bounds the window from
     ABOVE and picks them up - here, in the same run, because one extra page
     was enough to reach the bottom. */
  for (let i = 10; i < 40; i++) INBOX.push(mail(i, T0 + 100_000 + i * 1000));
  const r = await run();
  ok(listed(r.text) === 30, 'all thirty, not the newest twenty-five', listed(r.text));
  ok(/Subject 10\b/.test(r.text) && /Subject 39\b/.test(r.text),
     'including both ends of the burst', { oldest: /Subject 10\b/.test(r.text), newest: /Subject 39\b/.test(r.text) });
  ok(!/STILL CATCHING UP/.test(r.text),
     'and nothing is claimed to be outstanding, because nothing is', r.text);

  const rec = JSON.parse(store.get('ingest:' + EMAIL));
  ok(rec.src[W.INGEST_SRC_MAIL].gap === null, 'the hole is closed in the record too', rec.src[W.INGEST_SRC_MAIL].gap);

  const again = await run();
  ok(listed(again.text) === 0, 'and none of the thirty comes back on the next run', again.text);
}

section('A burst too big for one run says so, and finishes on the next');
{
  /* Sixty at once needs three pages, and a run has a deadline - draining a
     huge burst in one tick starves every other job on that tick. So it takes
     one page down per run and SAYS that the list is not everything, which is
     the difference between being behind and being wrong. */
  for (let i = 100; i < 160; i++) INBOX.push(mail(i, T0 + 2_000_000 + i * 1000));
  const first = await run();
  ok(listed(first.text) === 50, 'two pages this run - the new one and one down into the hole', listed(first.text));
  ok(/STILL CATCHING UP/.test(first.text),
     'and it says older unreported mail is still below the list', first.text);
  ok(/do not present the list as everything/i.test(first.text),
     'with an instruction not to summarise it as complete', first.text);

  const rec = JSON.parse(store.get('ingest:' + EMAIL));
  const g = rec.src[W.INGEST_SRC_MAIL].gap;
  ok(g && g.to > 0, 'the hole is recorded, not only mentioned', g);
  ok(g.to < rec.src[W.INGEST_SRC_MAIL].cursor,
     'as a hole BELOW the frontier - which is where a newest-first page leaves one',
     { to: g.to, cursor: rec.src[W.INGEST_SRC_MAIL].cursor });

  const second = await run();
  ok(listed(second.text) === 10, 'the last ten arrive on the next run', listed(second.text));
  ok(!/STILL CATCHING UP/.test(second.text), 'and the hole is closed', second.text);

  const third = await run();
  ok(listed(third.text) === 0, 'with nothing repeated across the three runs', third.text);
}

section('A run that produced nothing does not consume its mail');
{
  INBOX.push(mail(99, T0 + 3_000_000));
  const failed = await run({ commit: false });
  ok(listed(failed.text) === 1, 'the run saw it', failed.text);

  const next = await run();
  ok(listed(next.text) === 1 && /Subject 99/.test(next.text),
     'and because nothing was delivered, the next run sees it again', next.text);
}

section('The ring of remembered ids is bounded');
{
  const rec = JSON.parse(store.get('ingest:' + EMAIL));
  const seen = rec.src[W.INGEST_SRC_MAIL].seen;
  ok(Array.isArray(seen) && seen.length <= W.INGEST_SEEN_MAX,
     'it cannot grow without limit on a busy account', seen.length);
  ok(seen[seen.length - 1] === 'm99', 'and the newest is the one kept', seen.slice(-3));
}

section('A cursor never moves backwards');
{
  /* Two ticks can overlap. An older one finishing last must not rewind the
     cursor and replay a digest somebody already read. */
  const rec = JSON.parse(store.get('ingest:' + EMAIL));
  const high = rec.src[W.INGEST_SRC_MAIL].cursor;
  rec.src[W.INGEST_SRC_MAIL].seen = [];        /* forget, so a write is attempted */
  store.set('ingest:' + EMAIL, JSON.stringify(rec));
  INBOX.push(mail(50, T0 + 500));   /* far older than the cursor */
  await run();
  const after = JSON.parse(store.get('ingest:' + EMAIL));
  ok(after.src[W.INGEST_SRC_MAIL].cursor >= high,
     'a late run with older mail cannot pull the cursor back', { high, after: after.src[W.INGEST_SRC_MAIL].cursor });
}

section('An unreadable record repeats rather than drops, and then heals');
{
  /* The direction is what matters. Treating a corrupt record as "has seen
     everything" would silently discard mail; treating it as "has seen nothing"
     costs one repeated digest. It falls the second way.

     And unlike a wallet, this record is DERIVED - everything in it can be
     rebuilt by reporting the newest mail again - so it is replaced rather than
     preserved. Refusing to write would leave deduplication broken for that
     account for ever, which is the worse of the two. */
  store.set('ingest:' + EMAIL, '{ this is not json');
  INBOX.push(mail(77, T0 + 4_000_000));
  const r = await run();
  ok(listed(r.text) > 0, 'it still reports mail rather than reporting nothing', listed(r.text));

  const healed = JSON.parse(store.get('ingest:' + EMAIL));
  ok(healed && healed.src && healed.src[W.INGEST_SRC_MAIL].cursor > 0,
     'and the corrupt record is replaced, so dedup works again next time', healed);

  const next = await run();
  ok(listed(next.text) === 0, 'which it does - the repeat is a one-off, not permanent', next.text);
}

section('And the commit is actually wired to the run that delivers');
{
  /* THE ASSERTIONS ABOVE ALL CALL `commit()` THEMSELVES.

     That proves the bookkeeping is right and proves nothing about whether the
     product ever reaches it. Deleting the hand-off from `_autoExecute` left
     every one of them green - the same shape as LESSONS 405, where a policy
     engine 45 tests agreed with was load-bearing for nothing.

     So this one drives `runDueAutomations`, the function the cron calls, with
     a due job and a fake model, and asks the stored record whether the cursor
     moved. Nothing here is stubbed between the mailbox and the write. */
  store.clear();
  INBOX = [mail(200, T0 + 9_000_000), mail(201, T0 + 9_001_000)];
  await env.AMV_KV.put('auto:' + EMAIL, JSON.stringify({ items: [{
    id: 'cron1', detail: 'what needs a reply', repeat: 'daily', interval: 86400000,
    next: Date.now() - 60000, kind: 'task', approval: 'auto', notify: 'app',
    active: true, runs: 0, lastError: null, uses: ['mail.read'] }], results: [] }));

  const before = modelCalls;
  await W.runDueAutomations(env);
  ok(modelCalls > before, 'the job actually ran', { before, after: modelCalls });

  const raw = store.get('ingest:' + EMAIL);
  ok(!!raw, 'the cron path wrote an ingest record at all', raw);
  const rec = JSON.parse(raw || '{}');
  const b = (rec.src || {})[W.INGEST_SRC_MAIL] || {};
  ok(Number(b.cursor) === T0 + 9_001_000,
     'and the cursor is at the newest message the run reported', b.cursor);
  ok(Array.isArray(b.seen) && b.seen.indexOf('m200') >= 0 && b.seen.indexOf('m201') >= 0,
     'with both messages recorded as told about', b.seen);
}

globalThis.fetch = realFetch;
if (report('ingest-cursor') > 0) process.exitCode = 1;
done();
