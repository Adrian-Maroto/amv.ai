/* A TEMPLATE IS A COPY; A SHARED PROJECT IS ONE (Build 16 audit D16-10, Nov 21).

   The Team page had "Shared library" with "Share a project", and below it
   "Projects you edit together" - two names that read alike for opposite
   things: one hands each teammate a copy of their own, the other is a single
   project everybody edits. Now the work done together comes first, the copy
   is called a template, and the share and the use each say it is a copy. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;
const TEAM = { id: 'team_abc', name: 'Acme', ownerEmail: 'owner@x.com', plan: 'elite', seats: { used: 2, limit: 10, over: 0 },
  members: [{ email: 'owner@x.com', role: 'owner', joinedAt: 1, seated: true }, { email: 'bob@x.com', role: 'member', joinedAt: 2, seated: true }] };
const SHARED = [{ id: 's1', kind: 'project', title: 'Client onboarding', by: 'bob@x.com', byName: 'Bob', item: { name: 'Client onboarding', instructions: 'Be brief.' } }];

await page.evaluate(([team, shared]) => {
  window.AMVTeam.enabled = () => true; window.AMVTeam._cache = null;
  window.AMV_API._fetch = async (path) => ({ ok: true, status: 200, json: async () =>
    path === '/team/get' ? { ok: true, team } : path === '/team/shared' ? { ok: true, shared } : { ok: true, projects: [] } });
  S.workspaces = [{ id: 'w1', name: 'My project', instructions: '' }];
  window.__toasts = []; const t = window.toast; window.toast = (m, k, d) => { window.__toasts.push(String(m)); };
  saveStr('amv_plan', 'elite'); S.tab = 'team'; setTab('team');
}, [TEAM, SHARED]);
await page.waitForSelector('#team-share-project', { timeout: 15000 });
await page.waitForFunction(() => /Client onboarding/.test((document.getElementById('team-shared') || {}).textContent || ''), null, { timeout: 15000 });

section('The page names the two for what they are');
{
  const r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#vc .ss2 > h3')].map(h => h.textContent.replace(/\s+/g, ' ').trim());
    return { heads, button: document.getElementById('team-share-project').textContent };
  });
  const together = r.heads.findIndex(h => /^Projects you edit together/.test(h));
  const tpl = r.heads.findIndex(h => /^Templates/.test(h));
  ok(together >= 0 && tpl > together, 'the projects edited together come first, then templates', r.heads);
  ok(/own copy/.test(r.heads[tpl] || '') && !r.heads.some(h => /Shared library/.test(h)), 'templates say each person gets their own copy', r.heads[tpl]);
  ok(/copy/.test(r.button), 'and the share button says it shares a copy', r.button);
}

section('Sharing says it before anything is shared');
{
  await page.click('#team-share-project');
  const t = await page.evaluate(() => (document.querySelector('#ovr .ob') || {}).textContent || '');
  ok(/own copy/.test(t) && /Share with my team for editing/.test(t), 'a copy each, and where to go to edit one together instead', t.replace(/\s+/g, ' ').slice(0, 200));
  await page.evaluate(() => closeOvr());
}

section('Using a template says it is a copy');
{
  const r = await page.evaluate(async () => {
    document.querySelector('[data-tsr-use="s1"]').click(); await new Promise(r => setTimeout(r, 50));
    return { toasts: window.__toasts, n: S.workspaces.length };
  });
  ok(r.n === 2 && r.toasts.some(t => /A copy is in your projects/.test(t) && /yours alone/.test(t)), 'the copy is made, and said to be yours alone', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
