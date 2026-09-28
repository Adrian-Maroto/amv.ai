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

/* THE DOOR IS THE TOPIC'S OWN LIST NOW.

   Every topic used to end in a door into the open registry - "See all email
   connectors" - a page of programs anybody can publish. The owner asked for
   the main six, then a small See all, and not the sketchy ones nobody uses. So
   a topic's door opens the rest of THAT topic, in place, and nothing under a
   topic sends people into the registry; searching still reaches it, for
   somebody looking for one by name.

   What this file has always held survives the change: no lump called
   "everything", thirty-odd named topics, none listed twice, and no topic a
   dead end - a topic with more than six apps has a way to see the rest. */
const shape = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('#int-catalog > .ss2')];
  return {
    lump: /everything amv can connect to/i.test(document.body.innerText),
    headings: secs.map(s => (s.querySelector('h3') || {}).textContent.trim()),
    doors: secs.map(s => s.querySelector('[data-app-more]')).filter(Boolean).map(b => b.dataset.appMore),
    registry: document.querySelectorAll('#int-catalog [data-dact="cdirAll"], #int-catalog .cdir-more').length,
    /* A topic that holds more than it shows, with no way to see the rest. */
    deadEnds: secs.filter(s => {
      const cat = AMV_APP_CATS.find(c => c.t.replace(/&amp;/g, '&') === (s.querySelector('h3') || {}).textContent);
      return cat && cat.apps.length > s.querySelectorAll('.int-card').length && !s.querySelector('[data-app-more]');
    }).map(s => s.querySelector('h3').textContent.trim()),
    search: !!document.getElementById('cdir-find'),
  };
});

section('The lump is gone, and every topic ends in its own See all');
{
  ok(!shape.lump, 'no section is called "everything AMV can connect to"');
  ok(shape.headings.length >= 30, 'there are thirty or more named topics', shape.headings.length);
  ok(shape.deadEnds.length === 0, 'no topic is a dead end', shape.deadEnds);
  ok(shape.registry === 0, 'and none of them leads into the unvetted registry', shape.registry);
  ok(shape.search, 'which is still one search away, for somebody looking for a name', shape.search);
}

section('No topic is listed twice');
{
  const seen = new Map();
  shape.headings.forEach(h => seen.set(h.toLowerCase(), (seen.get(h.toLowerCase()) || 0) + 1));
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  ok(dupes.length === 0, 'each heading appears once', dupes);
  const qs = new Map();
  shape.doors.forEach(d => qs.set(d, (qs.get(d) || 0) + 1));
  const same = [...qs.entries()].filter(([, n]) => n > 1).map(([q]) => q);
  ok(same.length === 0, 'and no two See alls open the same topic', same);
}

section('See all opens the rest of its own topic');
{
  /* Checked by pressing it and counting what is on screen afterwards, rather
     than by comparing the label with the data - they are written side by side. */
  const r = await page.evaluate(async () => {
    const sec = () => [...document.querySelectorAll('#int-catalog > .ss2')].find(s => /^Email$/.test((s.querySelector('h3') || {}).textContent));
    const b = sec() && sec().querySelector('[data-app-more]');
    if (!b) return { none: true };
    const before = sec().querySelectorAll('.int-card').length;
    b.click();
    await new Promise(res => setTimeout(res, 300));
    const cat = AMV_APP_CATS.find(c => c.id === 'email');
    return { before, after: sec().querySelectorAll('.int-card').length, total: cat.apps.length,
             names: [...sec().querySelectorAll('.int-name')].map(e => e.textContent),
             label: (sec().querySelector('[data-app-more]') || {}).textContent || '' };
  });
  ok(!r.none, 'the email topic has a See all', r);
  ok(r.before === 6 && r.after === r.total, 'pressing it shows every email app, not six', r);
  ok(r.names.includes('Gmail') && r.names.includes('Proton Mail'), 'and they are email apps', r.names.slice(0, 8));
  ok(/fewer/i.test(r.label), 'and it can be closed again', r.label);
}

ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
