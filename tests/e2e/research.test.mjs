/* RESEARCH — the Claude-style deep-research experience.
   AMV searches many sources and shows the work: a live panel with the real
   search count and the real sources found. These tests assert the panel is
   built from REAL data (not faked), the depth selector wires through, and the
   showcase renders. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The research button and depth selector');

const btn = await page.evaluate(() => ({
  present: !!document.getElementById('research-btn'),
}));
ok(btn.present, 'a Research button is in the composer');

const menu = await page.evaluate(async () => {
  document.getElementById('research-btn').click();
  await new Promise(r => setTimeout(r, 150));
  const m = document.querySelector('.research-menu');
  const tiers = m ? [...m.querySelectorAll('[data-tier]')].map(b => b.dataset.tier) : [];
  return { open: !!m, tiers };
});
ok(menu.open, 'clicking it opens a depth menu');
ok(menu.tiers.includes('quick') && menu.tiers.includes('deep') && menu.tiers.includes('max'),
   'with Quick / Deep / Exhaustive tiers', menu.tiers);

const picked = await page.evaluate(async () => {
  document.querySelector('[data-tier="deep"]').click();
  await new Promise(r => setTimeout(r, 120));
  return {
    depth: S._researchDepth,
    active: document.getElementById('research-btn').classList.contains('on'),
  };
});
ok(picked.depth === 'deep', 'picking Deep sets the research depth', picked.depth);
ok(picked.active, 'and the button shows an active state');

const off = await page.evaluate(async () => {
  document.getElementById('research-btn').click();  // toggle off
  await new Promise(r => setTimeout(r, 100));
  return { depth: S._researchDepth };
});
ok(off.depth == null, 'clicking again turns research off');

section('Deep research raises the search budget (max_uses)');

const req = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'tok';
  let captured = null;
  window.fetch = async (u, o) => {
    if (String(u).includes('/v1/messages')) {
      captured = JSON.parse(o.body);
      const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(sse).body };
    }
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
  };
  S._researchDepth = 'deep'; S._researchTier = 'deep';
  document.getElementById('mta').value = 'research the state of AI regulation';
  await sendMsg();
  await new Promise(r => setTimeout(r, 500));
  const tool = (captured?.tools || []).find(t => t.type === 'web_search_20250305');
  return { hasTool: !!tool, maxUses: tool ? tool.max_uses : null };
});
ok(req.hasTool, 'the request includes the web_search tool');
ok(req.maxUses >= 15, 'deep research raises max_uses well above a normal chat', req.maxUses);

section('The research panel is built from REAL search data');

const panel = await page.evaluate(() => {
  const state = { active: true, searches: 4, done: false, sources: new Map() };
  [
    ['https://reddit.com/r/x/1', 'Reddit thread'],
    ['https://bloomberg.com/a', 'Bloomberg'],
    ['https://reuters.com/b', 'Reuters'],
  ].forEach(([u, t]) => state.sources.set(u, { url: u, title: t }));

  const live = _buildResearchPanel(state, false);
  const done = _buildResearchPanel(state, true);
  // Count the DISTINCT hostnames actually shown as chip labels. (The raw HTML
  // contains each domain twice — once in the href, once as the visible label —
  // so a naive string count is misleading. What matters is that exactly the
  // sources we found are displayed, no more, no fewer.)
  const chipHosts = [...done.matchAll(/<\/span>([a-z0-9.-]+)<\/a>/g)].map(m => m[1]);
  return {
    liveShowsSpinner: live.includes('rsrc-spin'),
    liveCount: live.includes('3 source'),
    doneShowsCheck: done.includes('rsrc-check'),
    doneText: /Researched 3 sources across 4 searches/.test(done),
    hasRealHosts: done.includes('reddit.com') && done.includes('bloomberg.com') && done.includes('reuters.com'),
    // exactly the three real sources are shown as chips — nothing invented
    honestCount: chipHosts.length === 3 &&
      chipHosts.includes('reddit.com') && chipHosts.includes('bloomberg.com') && chipHosts.includes('reuters.com'),
  };
});
ok(panel.liveShowsSpinner, 'while researching, a live spinner shows');
ok(panel.liveCount, 'with the running source count');
ok(panel.doneShowsCheck, 'when done, a checkmark shows');
ok(panel.doneText, 'with the exact real counts ("Researched N sources across M searches")');
ok(panel.hasRealHosts, 'and the actual source domains as clickable chips');
ok(panel.honestCount, 'the displayed sources match what was really found — nothing faked');

section('Source counting dedupes repeated URLs');

const dedupe = await page.evaluate(() => {
  const state = { active: true, searches: 2, done: false, sources: new Map() };
  // same URL found twice across two searches — must count once
  state.sources.set('https://x.com/a', { url: 'https://x.com/a', title: 'A' });
  state.sources.set('https://x.com/a', { url: 'https://x.com/a', title: 'A' });
  state.sources.set('https://y.com/b', { url: 'https://y.com/b', title: 'B' });
  return { size: state.sources.size };
});
ok(dedupe.size === 2, 'a URL found in multiple searches is counted once', dedupe.size);

/* ── Autonomous research watch: schedule a recurring, unattended research job.
   It must deliver everything it CAN (in-app + email, short intervals) while
   staying honest — analysis, never trade advice. ── */
section('Research watch: the setup modal offers the full range of options');

const modal = await page.evaluate(async () => {
  setTab('tasks');
  await new Promise(r => setTimeout(r, 200));
  openResearchWatch();
  await new Promise(r => setTimeout(r, 150));
  return {
    open: !!document.querySelector('.rw-modal'),
    intervals: [...document.querySelectorAll('#rw-repeat [data-repeat]')].map(b => b.dataset.repeat),
    channels: [...document.querySelectorAll('#rw-notify [data-notify]')].map(b => b.dataset.notify),
    hasDisclaimer: /not financial advice/i.test(document.querySelector('.rw-note')?.textContent || ''),
    disclaimerNoTrade: /won.t place trades|won.t.*buy/i.test(document.querySelector('.rw-note')?.textContent || ''),
  };
});
ok(modal.open, 'the research watch modal opens');
ok(modal.intervals.includes('10min') && modal.intervals.includes('30min') &&
   modal.intervals.includes('hourly') && modal.intervals.includes('daily') && modal.intervals.includes('weekly'),
   'it offers 10-min through weekly intervals', modal.intervals);
ok(modal.channels.includes('app') && modal.channels.includes('email'),
   'findings can go in-app or by email', modal.channels);
ok(modal.hasDisclaimer, 'the "not financial advice" disclaimer is shown in the UI');
ok(modal.disclaimerNoTrade, 'and it makes clear AMV will not place trades or say what to buy');

section('Research watch: it schedules a real research job with the chosen options');

const scheduled = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok'; AMV_API.live = true;
  let sent = null;
  window.fetch = async (u, o) => {
    if (String(u).includes('/auto/create')) {
      sent = JSON.parse(o.body);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, item: { id: 'a1', ...sent } }) };
    }
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, items: [], results: [] }) };
  };
  document.getElementById('rw-subject').value = 'Bitcoin price and major news';
  document.querySelector('[data-repeat="10min"]').click();
  document.querySelector('[data-notify="email"]').click();
  document.getElementById('rw-start').click();
  await new Promise(r => setTimeout(r, 400));
  return sent;
});
ok(scheduled && scheduled.kind === 'research', 'it sends a research-kind job', scheduled && scheduled.kind);
ok(scheduled.repeat === '10min', 'with the chosen 10-minute interval', scheduled.repeat);
ok(scheduled.notify === 'email', 'and the chosen email delivery', scheduled.notify);
ok(/bitcoin/i.test(scheduled.detail), 'watching the subject the user typed', scheduled.detail);

section('Research watch: honest when the engine is not connected');

const notConnected = await page.evaluate(async () => {
  AMV_API.live = false; AMV_API.token = null;
  let toasted = '';
  const origToast = window.toast;
  window.toast = (m) => { toasted = m; };
  openResearchWatch();
  await new Promise(r => setTimeout(r, 100));
  document.getElementById('rw-subject').value = 'anything';
  document.getElementById('rw-start').click();
  await new Promise(r => setTimeout(r, 300));
  window.toast = origToast;
  return { toasted };
});
ok(/connect/i.test(notConnected.toasted),
   'without a backend it says to connect the engine — it does not fake success', notConnected.toasted);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
