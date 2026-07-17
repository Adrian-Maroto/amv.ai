/* REGRESSIONS — every one of these is a bug that actually shipped and was fixed.
   If one goes red, that bug is back. Each test names the original symptom. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

/* ────────────────────────────────────────────────────────────────────────
   BUG: Font size "Large"/"Largest" zoomed #app (height:100vh) to 129vh, so
   the composer fell off the bottom of the screen and you could not type.
   ──────────────────────────────────────────────────────────────────────── */
section('Font size: the text box must stay reachable at every size');

for (const px of [13, 14, 16, 18]) {
  const r = await page.evaluate(async (px) => {
    saveStr('amv_fs', String(px));
    _applyFontSize();
    setTab('chat');
    await new Promise(r => setTimeout(r, 120));
    const vh = window.innerHeight;
    const app = document.getElementById('app');
    const mta = document.getElementById('mta');
    const t = mta.getBoundingClientRect();
    return {
      overflow: Math.round(app.getBoundingClientRect().height - vh),
      reachable: t.height > 4 && t.bottom <= vh + 2 && t.top >= 0,
      fontSize: parseFloat(getComputedStyle(mta).fontSize)
    };
  }, px);
  ok(r.reachable, `${px}px: composer is on screen and typable`, r);
  ok(r.overflow <= 2, `${px}px: app does not overflow the viewport`, r.overflow);
  ok(Math.abs(r.fontSize - px) < 1.5, `${px}px: text actually scales (a fix that kills the feature is not a fix)`, r.fontSize);
}

// reset
await page.evaluate(() => { saveStr('amv_fs', '14'); _applyFontSize(); });

/* ────────────────────────────────────────────────────────────────────────
   BUG: _sessTouch used ONE shared debounce timer, so touching Studio then
   Dev within ~900ms cancelled the Studio save — Studio never hit Recents.
   ──────────────────────────────────────────────────────────────────────── */
section('Recents: Dev, Lab AND Studio all persist (shared-timer bug)');

const rec = await page.evaluate(async () => {
  _SESSIONS.length = 0;
  _activeSession = {};
  _STUDIO.artifacts = [{ id: 'a1', html: '<h1>x</h1>', brief: 'A poster' }];
  _STUDIO.prompt = 'a poster';
  _sessTouch('studio');
  _DEV.project = { 'x.js': { content: 'a' } };
  _DEV.log = [{ role: 'user', text: 'build a game' }];
  _sessTouch('dev');
  _LAB.code = '// lab work';
  _sessTouch('lab');
  await new Promise(r => setTimeout(r, 1200));
  return _SESSIONS.map(s => s.kind).sort();
});
ok(rec.includes('studio'), 'Studio session saved', rec);
ok(rec.includes('dev'), 'Dev session saved', rec);
ok(rec.includes('lab'), 'Lab session saved', rec);
ok(rec.length === 3, 'all three coexist — none cancels another', rec);

/* BUG: Studio only saved AFTER the AI returned HTML, so a failed generation
   left nothing in Recents. */
const studioFail = await page.evaluate(async () => {
  _SESSIONS.length = 0;
  _activeSession = {};
  _STUDIO.artifacts = [];
  window.aiComplete = async () => { throw new Error('engine down'); };
  await _studioCreate('a coffee shop poster');
  await new Promise(r => setTimeout(r, 1200));
  return _SESSIONS.map(s => ({ kind: s.kind, title: s.title }));
});
ok(studioFail.some(s => s.kind === 'studio'),
   'Studio session survives a FAILED generation', studioFail);

/* ────────────────────────────────────────────────────────────────────────
   BUG: md() converted every \n to <br>, including between <li> elements.
   That is invalid HTML and produced huge dead gaps in every list.
   ──────────────────────────────────────────────────────────────────────── */
section('Markdown: no stray <br> inside block elements');

const mdOut = await page.evaluate(() => {
  const html = md('Intro:\n\n- one\n- two\n- three\n\nAfter the list.');
  const d = document.createElement('div');
  d.innerHTML = html;
  const ul = d.querySelector('ul');
  return {
    lis: d.querySelectorAll('li').length,
    brInUl: ul ? ul.querySelectorAll('br').length : -1
  };
});
ok(mdOut.lis === 3, 'renders a real 3-item list', mdOut.lis);
ok(mdOut.brInUl === 0, 'no <br> injected between list items', mdOut.brInUl);

/* ────────────────────────────────────────────────────────────────────────
   BUG: Lab shipped with demo code pre-loaded, so the entry screen that
   teaches you to paste/upload NEVER appeared.
   ──────────────────────────────────────────────────────────────────────── */
section('Lab: starts empty so the paste instructions are visible');

const lab = await page.evaluate(async () => {
  _LAB.code = '';
  _LAB.chat = [];
  setTab('lab');
  await new Promise(r => setTimeout(r, 300));
  return {
    code: (document.getElementById('lab-code') || {}).value || '',
    entryVisible: !!document.querySelector('.lab-entry'),
    hasPaste: !!document.getElementById('lab-paste'),
    hasChat: !!document.getElementById('lab-ask')
  };
});
ok(lab.code === '', 'Lab starts with NO pre-filled code', lab.code.slice(0, 40));
ok(lab.entryVisible, 'the "drop in your code" entry screen shows');
ok(lab.hasPaste, 'paste box is present');
ok(lab.hasChat, 'you can talk to Lab about the code');

/* ────────────────────────────────────────────────────────────────────────
   BUG: onboarding lived in loginUser(), but signup goes through
   _completeIntroLogin() — so brand-new users never saw it. Dead code.
   ──────────────────────────────────────────────────────────────────────── */
section('Onboarding: actually fires for a NEW signup');

const onb = await page.evaluate(async () => {
  S.user = { name: 'New', email: 'brandnew@test.com', ini: 'N' };
  saveStr('amv_onboarded', '');
  localStorage.removeItem(_scopeKey('amv_onboarded'));
  _completeIntroLogin({ name: 'New', email: 'brandnew@test.com', ini: 'N', provider: 'email' });
  await new Promise(r => setTimeout(r, 900));
  const shown = !!document.querySelector('.onb');
  const paths = [...document.querySelectorAll('[data-onb]')].length;
  try { closeOvr(); } catch (e) {}
  return { shown, paths };
});
ok(onb.shown, 'onboarding modal appears for a new user');
ok(onb.paths >= 3, 'it offers real starting paths', onb.paths);

/* ────────────────────────────────────────────────────────────────────────
   Header auth buttons: visible signed-out, gone signed-in.
   ──────────────────────────────────────────────────────────────────────── */
section('Header: Sign up shows only when signed out');

const hdr = await page.evaluate(() => {
  S.user = null; updateSbUser();
  const su = document.getElementById('hdr-signup');
  const nc = document.getElementById('ncb');
  const outVisible = !su.hidden;
  const leftOfNewChat = su.getBoundingClientRect().right <= nc.getBoundingClientRect().left + 2;
  S.user = { name: 'T', email: 't@t.com', ini: 'T' }; updateSbUser();
  const inHidden = su.hidden;
  return { outVisible, leftOfNewChat, inHidden };
});
ok(hdr.outVisible, 'Sign up is visible when signed out');
ok(hdr.leftOfNewChat, 'Sign up sits to the LEFT of New chat');
ok(hdr.inHidden, 'Sign up disappears once signed in');

/* ────────────────────────────────────────────────────────────────────────
   BUG: #ovr had NO CSS. Modals built as a bare .share-modal inside it rendered
   in normal document flow — at the very bottom of the page, off-screen. Share
   conversation had never worked; Deploy/My sites/Errors were invisible too.
   ──────────────────────────────────────────────────────────────────────── */
section('Modals are actually on screen (not rendered below the fold)');

await page.evaluate(() => {
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  saveStr('amv_admin_token', 's');
  window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, sites: [], groups: [], distinct: 0, total: 0, active24h: 0 }) });
  const m = getMsgs(); m.push({ r: 'u', c: 'hi', _t: Date.now() }); renderChatMsgs();
});

const modals = [
  ['Share conversation', 'const c=getCurConv(); shareConv(c && c.id);'],
  ['Deploy is-live',     '_showDeployed("https://x/s/a","App",false);'],
  ['My live sites',      'await openMySites();'],
  ['Errors dashboard',   'await openErrors();'],
];
for (const [name, code] of modals) {
  const r = await page.evaluate(async (code) => {
    try { closeOvr(); } catch (e) {}
    await eval('(async()=>{' + code + '})()');
    await new Promise(r => setTimeout(r, 350));
    const m = document.querySelector('.share-modal');
    if (!m) return { found: false };
    const rc = m.getBoundingClientRect();
    return { found: true, onScreen: rc.top >= 0 && rc.bottom <= window.innerHeight + 2 && rc.height > 0, top: Math.round(rc.top) };
  }, code);
  ok(r.found && r.onScreen, name + ' modal is visible on screen', r);
}
await page.evaluate(() => { try { closeOvr(); } catch (e) {} });

/* The sidebar was overwhelming new users. Team was removed, Projects moved into
   Settings, and the secondary tools (Memory, Tasks, Integrations, Marketplace)
   became a compact icon row at the bottom-left. This guards all of it. */
section('Sidebar is simplified — Team gone, tools in bottom row, Projects in Settings');

const sb = await page.evaluate(() => {
  const tools = document.getElementById('sb-tools');
  const toolTabs = tools ? [...tools.querySelectorAll('.sb-tool[data-tab]')].map(b => b.dataset.tab) : [];
  return {
    hasTeam: !!document.querySelector('.snb[data-tab="team"]'),
    projectsInSidebar: !!document.querySelector('.snb[data-tab="workspaces"]'),
    hasToolsRow: !!tools,
    toolTabs,
  };
});
ok(!sb.hasTeam, 'Team is removed from the sidebar');
ok(!sb.projectsInSidebar, 'Projects is no longer a sidebar tab (it moved to Settings)');
ok(sb.hasToolsRow, 'a compact bottom-left tools row exists');
ok(sb.toolTabs.includes('memory') && sb.toolTabs.includes('tasks') &&
   sb.toolTabs.includes('integrations') && sb.toolTabs.includes('market'),
   'Memory / Tasks / Integrations / Marketplace live in the tools row', sb.toolTabs);

const toolNav = await page.evaluate(async () => {
  document.querySelector('.sb-tool[data-tab="tasks"]').click();
  await new Promise(r => setTimeout(r, 120));
  const active = S.tab;
  const marked = document.querySelector('.sb-tool[data-tab="tasks"]').classList.contains('on');
  return { active, marked };
});
ok(toolNav.active === 'tasks', 'clicking a tool navigates to it', toolNav.active);
ok(toolNav.marked, 'and the tool shows an active state');

const projectsPane = await page.evaluate(async () => {
  goSettings('projects');
  await new Promise(r => setTimeout(r, 150));
  const vc = document.getElementById('vc');
  return {
    tab: S.tab,
    hasProjectsPane: /Projects/.test(vc.textContent) && !!vc.querySelector('#ws-grid'),
  };
});
ok(projectsPane.tab === 'settings', 'Projects opens inside Settings', projectsPane.tab);
ok(projectsPane.hasProjectsPane, 'and renders the projects grid there');

const teamGone = await page.evaluate(() => {
  setTab('team');
  return S.tab;
});
ok(teamGone === 'chat', 'navigating to the removed Team tab redirects to chat', teamGone);

/* The owner analytics dashboard once shipped broken: an edit dropped the
   `const el=$('adm-body')` line and _admRenderTab threw "el is not defined".
   This renders the dashboard with seeded stats and asserts it draws the growth
   block without error. */
section('Owner analytics dashboard renders (growth block, no crash)');

const adm = await page.evaluate(() => {
  // become the owner so isAdmin() passes
  S.user = { name: 'Op', email: (window.OWNER_EMAIL || 'amarotovaleria@gmail.com'), ini: 'O' };
  S._admStats = {
    generatedAt: Date.now(),
    spend: { today: 5, cap: 500, pctOfCap: 1, killed: false },
    users: { total: 100, paying: 15, byPlan: { free: 85, pro: 10, elite: 4, ultra: 1 }, conversionPct: 15, activeToday: 20 },
    growth: { signupsToday: 4, signups7: 20, signupsPrev7: 10, wowGrowthPct: 100,
              signups30: Array.from({length:30}, (_,i)=>({date:'2026-06-'+(i+1), count:i%7})), active30: [] },
    revenue: { estMRR: 900, estARR: 10800, arpu: 60 },
    margin: { estMonthlyCost: 200 }, topSpenders: []
  };
  S.tab = 'admin'; S._adminTab = 'overview';
  let threw = null;
  try { renderAdminView(); } catch (e) { threw = String(e.message || e); }
  const body = document.getElementById('adm-body');
  const txt = body ? body.textContent : '';
  return {
    threw,
    hasGrowth: /Signups today/.test(txt) && /WoW growth/.test(txt),
    hasConversion: /Conversion/.test(txt),
    hasSparkline: !!(body && body.querySelector('.adm-spark polyline'))
  };
});
ok(adm.threw === null, 'the admin dashboard renders without throwing', adm.threw);
ok(adm.hasGrowth, 'the growth KPIs are shown (Signups today, WoW growth)');
ok(adm.hasConversion, 'the conversion rate is shown');
ok(adm.hasSparkline, 'the 30-day signup sparkline is drawn');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
