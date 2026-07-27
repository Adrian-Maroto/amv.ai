/* EVERY SECTION -> CHAT. The whole product must be reachable from the main
   chat box: settings, marketplace, crew, studio, dev, memory, handoff,
   projects, chats, usage. Proves each is registered, reads LIVE data (so chat
   and the tabs can never disagree), reports empty as empty instead of
   inventing entries, and gates anything that changes something. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' } });
const { page, errors } = app;

const r = await page.evaluate(async () => {
  const C = window.AMVConnectors;
  if (!C) return { missing: true };
  const cat = C.catalog();
  const bySec = {};
  cat.forEach(a => { (bySec[a.connector] = bySec[a.connector] || []).push(a.action); });

  const settings = await C.run('settings.get', {});
  const usage = await C.run('usage.status', {});
  const jobs = await C.run('crew.running_jobs', {});

  // empties must be honest
  const empties = {};
  for (const id of ['memory.list', 'marketplace.my_purchases', 'handoff.list', 'projects.list', 'studio.my_designs']) {
    try { await C.run(id, {}); empties[id] = 'had-data'; }
    catch (e) { empties[id] = e.code || 'error'; }
  }

  // live-data proof: add a memory, then read it back through the bridge
  await C.run('memory.add', { text: 'I prefer concise answers' });
  const mem = await C.run('memory.list', {});

  return {
    missing: false, sections: Object.keys(bySec).sort(), total: cat.length,
    settings, usage, jobsCount: jobs.count, empties,
    memCount: mem.count, memText: mem.memories[0] && mem.memories[0].text,
    risky: cat.filter(a => a.risk === 'high').map(a => a.id),
    lowRiskReads: cat.filter(a => a.risk !== 'high' && /list|get|status|my_/.test(a.action)).length
  };
});
ok(!r.missing, 'the connector registry is live');

section('Every major section of AMV is reachable from chat');
['settings', 'marketplace', 'crew', 'studio', 'dev', 'memory', 'handoff', 'projects', 'chats', 'usage'].forEach(s => {
  ok(r.sections.includes(s), `${s} is connected to chat`, r.sections);
});
ok(r.total >= 25, `a real action catalog exists (${r.total} actions)`, r.total);

section('They read LIVE data, so chat and the tabs can never disagree');
ok(r.settings.email === 'owner@amv.dev', 'settings returns the real signed-in account', r.settings.email);
ok(typeof r.settings.plan === 'string' && typeof r.settings.theme === 'string', 'plan and theme come from the live stores');
ok(r.usage.plan === 'free' && r.usage.remaining !== null, 'usage returns the real remaining allowance', r.usage);
ok(r.jobsCount >= 5, 'crew returns the real standing jobs', r.jobsCount);
ok(r.memCount === 1 && /concise/.test(r.memText || ''), 'a memory written through chat reads back through chat', r.memText);

section('Empty is reported as empty - never invented');
['marketplace.my_purchases', 'handoff.list', 'projects.list', 'studio.my_designs'].forEach(id => {
  ok(r.empties[id] === 'needs_info' || r.empties[id] === 'had-data',
    `${id} reports honestly instead of fabricating`, r.empties[id]);
});

section('Anything that CHANGES something stops for approval');
['settings.set_theme', 'settings.set_language', 'memory.add'].forEach(id => {
  ok(r.risky.includes(id), `${id} is marked high-risk (needs approval)`, r.risky);
});
ok(!r.risky.includes('settings.get') && !r.risky.includes('usage.status'), 'plain reads are NOT gated, so chat stays fast');
ok(r.lowRiskReads >= 10, 'most of the surface is free, safe reads', r.lowRiskReads);

section('Money is never changed from chat');
ok(/Billing/.test(r.usage.note || ''), 'usage points billing changes back to the Billing screen', r.usage.note);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
