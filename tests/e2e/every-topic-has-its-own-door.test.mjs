/* "EVERYTHING AMV CAN CONNECT TO" WAS THE WRONG SHAPE, TWICE ASKED ABOUT.

   The page had a dozen hand-built topic sections - Email and calendar,
   Messaging and chat, Developer - and then, at the bottom, one lump holding
   nine thousand registry entries under a heading that describes none of them.
   Somebody looking for a mail connector reads "Email and calendar", finds four
   rows, and concludes that is what there is. The other nine thousand were on
   the same page and might as well not have been.

   The rows in a curated section are AMV's own integrations: a real sign-in at
   the provider, a scoped grant, a Connect that does what it says. There will
   never be thousands of those, because each is work somebody did by hand. The
   registry has thousands FOR EACH OF THESE TOPICS. So the door to them belongs
   at the end of the topic, not in a lump at the end of the page.

   WHAT THIS HOLDS:

   THE LUMP IS GONE, by its heading, because that heading is the thing that was
   objected to and a check for "no section named X" is the only way that stays
   true when somebody reorganises this page again.

   EVERY SECTION HAS A DOOR, curated and registry alike. A topic with no way
   through to the rest of its own kind is the defect this replaced.

   THE DOOR RUNS THE QUERY ITS HEADING CLAIMS. A door under "Email and
   calendar" that searches for something else is worse than no door: it is a
   heading promising a search it does not run.

   AND NO TOPIC APPEARS TWICE. The first version of this listed "Developer"
   and "Developer tools", and "Productivity" twice - one heading from the
   hand-built sections and one from the registry, adjacent, asking somebody to
   work out a difference that does not exist.

   BROKEN THREE WAYS. Putting the lump's heading back fails the first line.
   Taking the doors off the curated sections fails five at once. Removing the
   de-duplication brings back "Developer" beside "Developer tools" and fails
   both duplicate lines - the heading one and the stronger one about two doors
   running the same search. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BASE = 'https://backend.example.workers.dev';
const app = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const asked = [];
await page.route('**/v1/connectors**', (r) => {
  const u = new URL(r.request().url());
  const q = u.searchParams.get('q') || '';
  const want = Math.min(48, +u.searchParams.get('limit') || 5);
  asked.push(q);
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true, cursor: '',
    servers: Array.from({ length: want }, (_, i) => ({
      id: 'io.github.a' + i + '/' + q, name: q + ' ' + i, by: 'a',
      desc: 'A connector for ' + q, version: '1', command: 'npx', args: ['-y', 'x'], env: [] })) }) });
});
await page.route('**/v1/connector-logo**', (r) => r.fulfill({ status: 404, body: 'x' }));
await page.route('**/v1/connect/list**', (r) => r.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ ok: true, providers: [], items: [] }) }));

await page.evaluate((b) => {
  saveStr('amv_api_base', b); saveStr('amv_api_token', 'tok');
  saveStr('amv_token_exp', String(Date.now() + 3e6));
  setTab('integrations');
}, BASE);
await page.waitForTimeout(4200);

const shape = await page.evaluate(() => ({
  lump: /everything amv can connect to/i.test(document.body.innerText),
  headings: [...document.querySelectorAll('.ss2 > h3')].map(h => h.textContent.trim()),
  doors: [...document.querySelectorAll('.cdir-more')].map(b => ({
    label: b.textContent.trim(), q: b.dataset.darg })),
  /* A section with a heading and no door is the thing being fixed. */
  sectionsWithoutDoor: [...document.querySelectorAll('.ss2')]
    .filter(s => s.querySelector('h3') && !s.querySelector('.cdir-more'))
    .map(s => s.querySelector('h3').textContent.trim()),
}));

section('The lump is gone and the topics carry it instead');
{
  ok(!shape.lump, 'no section is called "everything AMV can connect to"');
  ok(shape.headings.length >= 30, 'there are thirty or more named topics', shape.headings.length);
  ok(shape.doors.length === shape.headings.length,
     'and one door per topic', { doors: shape.doors.length, topics: shape.headings.length });
  ok(shape.sectionsWithoutDoor.length === 0,
     'no topic is a dead end', shape.sectionsWithoutDoor);
}

section('No topic is listed twice');
{
  const seen = new Map();
  shape.headings.forEach(h => seen.set(h.toLowerCase(), (seen.get(h.toLowerCase()) || 0) + 1));
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  ok(dupes.length === 0, 'each heading appears once', dupes);
  /* The stronger form: two headings running the SAME query is the duplication
     that matters, whatever they are called. */
  const qs = new Map();
  shape.doors.forEach(d => qs.set(d.q, (qs.get(d.q) || 0) + 1));
  const sameQuery = [...qs.entries()].filter(([, n]) => n > 1).map(([q]) => q);
  ok(sameQuery.length === 0, 'and no two doors run the same search', sameQuery);
}

section('A door goes where its heading says');
{
  /* Checked by opening one and reading what came back, rather than by
     comparing two strings in the page - the label and the query are written
     side by side, so comparing them proves only that they were typed
     together. */
  const r = await page.evaluate(async () => {
    const d = [...document.querySelectorAll('.cdir-more')]
      .find(b => /email/i.test(b.textContent));
    if (!d) return { none: true };
    const q = d.dataset.darg;
    d.click();
    await new Promise(res => setTimeout(res, 900));
    return { q, full: !!document.querySelector('.cdir-full'),
             title: (document.querySelector('.cdir-full h3') || {}).textContent || '',
             tiles: document.querySelectorAll('.cdir-full .cdir-tile').length,
             names: [...document.querySelectorAll('.cdir-full .cdir-name')]
                      .slice(0, 3).map(e => e.textContent) };
  });
  ok(!r.none, 'the email topic has a door', r);
  ok(r.full, 'pressing it opens a page of its own', r);
  ok(r.tiles > 30, 'with far more than the handful the section showed', r.tiles);
  ok(r.names.every(n => n.indexOf(r.q) === 0),
     'and what came back is that topic, not another one', { q: r.q, got: r.names });
}

ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
