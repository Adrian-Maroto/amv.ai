/* SWITCH A JOB ON FROM YOUR PHONE, AND YOUR LAPTOP NEVER FINDS OUT.

   The write half of Crew was real. Toggling a job calls AMV_API.toggleJob from
   two places, the server stores it, and the row is there.

   The read half was orphaned. AMV_API.jobs() appeared exactly once in the whole
   client, inside _crewSyncLive, and nothing called _crewSyncLive. AMV_API
   .listHandoff() appeared exactly once, inside _handoffSyncLive, and nothing
   called that either.

   So every device kept its own picture, the server's copy was write-only, and
   the product silently behaved like local storage with a backup nobody read. A
   handoff somebody sent you was invisible unless you happened to be on the
   device that sent it.

   That is the third instance of one shape in this codebase: correct at both
   ends, not joined in the middle. It is the only one that cost a user
   something every day.

   This drives it the way a person does - open the tab - rather than calling the
   sync function, because "the function works" was never in doubt. What was
   missing is that anything calls it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await app.connect();

/* The server's answer, and a record of what was asked for. */
await page.evaluate(() => {
  window.__asked = [];
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    window.__asked.push(u);
    if (u.includes('/api/jobs')) {
      return new Response(JSON.stringify({ jobs: [{ key: 'morning_brief', on_flag: true }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('/api/approvals')) {
      return new Response(JSON.stringify({ approvals: [
        { id: 'ap_1', icon: '✉️', title: 'A draft waiting on you', preview: 'from another device' } ] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('/api/handoff')) {
      return new Response(JSON.stringify({
        incoming: [{ id: 'ho_1', from_email: 'colleague@example.com', title: 'Finish the pricing page', context: 'the copy is drafted' }],
        sent: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
});

const settle = () => page.waitForTimeout(700);

section('Opening Crew asks the server what is actually running');
{
  /* Nothing about the local state says this job is on - which is the whole
     point. If the screen shows it on, the only place that could have come from
     is the server. */
  const before = await page.evaluate(() => {
    const j = (load('amv_cw_jobs') || _cwDefaultJobs()).find(x => x.id === 'morning_brief');
    return !!(j && j.on);
  });
  ok(before === false, 'this device has never switched that job on', before);

  await page.evaluate(() => setTab('crew'));
  await settle();

  const asked = await page.evaluate(() => window.__asked.filter(u => u.includes('/api/jobs')).length);
  ok(asked > 0, 'opening the tab asks for the jobs', asked);

  const after = await page.evaluate(() => {
    const j = (load('amv_cw_jobs') || []).find(x => x.id === 'morning_brief');
    return !!(j && j.on);
  });
  ok(after === true, 'and what another device switched on is on here', after);
}

section('The catalogue is merged into, not replaced by, what the server holds');
{
  /* The server keeps a row only for jobs that have ever been touched. Replacing
     the list with those rows would collapse a catalogue of dozens into the one
     job that came back - and would drop the category, the instruction and the
     id of the scheduled work, so switching it off could no longer stop it. */
  const shape = await page.evaluate(() => {
    const all = load('amv_cw_jobs') || [];
    const j = all.find(x => x.id === 'morning_brief');
    return { count: all.length, hasCat: !!(j && j.cat), hasPrompt: !!(j && j.prompt),
             defaults: (typeof _cwDefaultJobs === 'function') ? _cwDefaultJobs().length : 0 };
  });
  ok(shape.count === shape.defaults,
     'every job in the catalogue is still there, not just the one the server knew about', shape);
  ok(shape.hasCat && shape.hasPrompt,
     'each keeps what it IS - the grouping and the instruction it runs', shape);
}

section('And what is waiting for approval comes back too');
{
  const appr = await page.evaluate(() => (load('amv_cw_approvals') || []).map(a => a.id));
  ok(appr.includes('ap_1'), 'an approval raised elsewhere is here', appr);
}

section('Opening Handoff asks who handed something to you');
{
  const before = await page.evaluate(() => (load('amv_handoffs_in') || []).length);
  await page.evaluate(() => setTab('handoff'));
  await settle();
  const asked = await page.evaluate(() => window.__asked.filter(u => u.includes('/api/handoff')).length);
  ok(asked > 0, 'opening the tab asks for them', asked);

  const inbox = await page.evaluate(() => (load('amv_handoffs_in') || []).map(h => h.title));
  ok(inbox.includes('Finish the pricing page'),
     'and work somebody handed over is waiting here', { before, inbox });

  const onScreen = await page.evaluate(() => document.getElementById('vc').textContent || '');
  ok(onScreen.includes('Finish the pricing page'),
     'on the screen, not only in storage - the sync redraws the tab it is on', onScreen.slice(0, 80));
}

section('A sync that answers after they have moved on does not redraw under them');
{
  /* The sync is fired when the tab opens and answers whenever the network
     answers. Somebody who moved on would otherwise have the screen they are
     reading replaced by the one they left. */
  await page.evaluate(() => { S.tab = 'chat'; setTab('chat'); });
  await page.evaluate(() => _crewSyncLive());
  await settle();
  const still = await page.evaluate(() => S.tab);
  const text = await page.evaluate(() => document.getElementById('vc').textContent || '');
  ok(still === 'chat', 'they are still where they were', still);
  ok(!/Things that do not repeat/.test(text),
     'and the Crew screen was not drawn over the one they are reading', text.slice(0, 60));
}

section('Nothing here needs the network to render');
{
  /* Honest degradation: the tab must open on what is on disk whether or not the
     server answers, or a slow network becomes a blank screen. */
  await page.evaluate(() => {
    window.fetch = async () => { throw new Error('offline'); };
  });
  await page.evaluate(() => setTab('crew'));
  await settle();
  const text = await page.evaluate(() => document.getElementById('vc').textContent || '');
  ok(text.length > 200, 'Crew still renders with the server unreachable', text.length);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
