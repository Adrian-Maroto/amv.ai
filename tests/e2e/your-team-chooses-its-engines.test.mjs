/* YOUR TEAM CHOOSES ITS ENGINES - THE SCREENS.

   The server enforces a team's engine choice (tests/worker/
   a-team-chooses-its-engines). What is checked here, in a real browser, is
   that the app says it before a send is refused:

   - the owner sees the Engines section, with Pulse and Core always on, ticks
     one engine, and Save sends exactly that list to /team/policy;
   - the chat engine menu marks the others "Turned off by your team", and
     choosing one explains who can change it instead of offering an upgrade
     that would not help;
   - the per-section engine select disables them too;
   - a member sees which engines the team uses, with no controls;
   - the activity log reads the change in engine names;
   - with no team rule, nothing is marked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;

const TEAM = {
  id: 'team_abc', name: 'Acme', ownerEmail: 'owner@x.com',
  members: [
    { email: 'owner@x.com', role: 'owner', joinedAt: 1, seated: true },
    { email: 'bob@x.com', role: 'member', joinedAt: 2, seated: true },
  ],
  plan: 'elite', seats: { used: 2, limit: 10, over: 0 },
};
const LOG = [{ t: Date.now(), actor: 'owner@x.com', action: 'engines_changed', engines: 'amv-pulse,amv-core,amv-swift', before: 'all' }];

const serve = (team, me) => page.evaluate(([t, me, log]) => {
  window.__policySent = [];
  S.user = Object.assign({}, S.user, { email: me });
  window.AMVTeam.enabled = () => true;
  window.AMVTeam._cache = null;
  window.AMV_API._fetch = async (path, init) => {
    if (path === '/team/get') return { ok: true, status: 200, json: async () => ({ ok: true, team: t }) };
    if (path === '/team/audit') return { ok: true, status: 200, json: async () => ({ ok: true, log }) };
    if (path === '/team/policy') {
      const b = JSON.parse(init.body); window.__policySent.push(b.engines);
      const now = Array.isArray(b.engines) ? ['amv-pulse', 'amv-core'].concat(b.engines) : null;
      return { ok: true, status: 200, json: async () => ({ ok: true, engines: now }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [], shared: [] }) };
  };
  saveStr('amv_plan', 'elite');
  S.tab = 'team';
  return setTab('team');
}, [team, me, LOG]);
const host = () => page.evaluate(() => (document.getElementById('set-modal') || document.getElementById('vc')).id);

section('The owner chooses, and Save sends exactly that list');
{
  await serve(TEAM, 'owner@x.com');
  await page.waitForSelector('#team-eng-save', { timeout: 15000 });
  const r = await page.evaluate(() => ({
    fixed: [...document.querySelectorAll('.team-eng-row.is-fixed b')].map(b => b.textContent),
    choosable: [...document.querySelectorAll('[data-team-eng]')].map(x => x.dataset.teamEng),
    listHidden: document.getElementById('team-eng-list').hidden,
  }));
  ok(r.fixed.join(',') === 'AMV Pulse,AMV Core', 'Pulse and Core are shown as always on', r.fixed);
  ok(r.choosable.includes('amv-forge') && r.choosable.includes('amv-swift') && !r.choosable.includes('amv-core'), 'the other engines can be chosen', r.choosable);
  ok(r.listHidden === true, 'with no rule yet, it says every engine on the plan and hides the list');
  await page.click('input[name="team-eng-mode"][value="some"]');
  await page.evaluate(() => document.querySelectorAll('[data-team-eng]').forEach(x => { x.checked = x.dataset.teamEng === 'amv-swift'; }));
  await page.click('#team-eng-save');
  await page.waitForFunction(() => window.__policySent.length === 1, null, { timeout: 5000 });
  const sent = await page.evaluate(() => window.__policySent[0]);
  ok(JSON.stringify(sent) === '["amv-swift"]', 'Save sent only the ticked engine', sent);
  await page.waitForSelector('.team-log-row', { timeout: 5000 });
  const log = await page.evaluate(() => document.querySelector('.team-log').textContent);
  ok(/changed which engines the team uses/.test(log) && /AMV Swift/.test(log), 'the activity log reads it in engine names', log);
}

section('The chat menu says it before a send is refused');
{
  await page.evaluate(() => { document.getElementById('set-modal')?.remove(); setTab('chat'); });
  const r = await page.evaluate(() => {
    const out = {};
    out.forge = _teamAllowsModel('coding'); out.swift = _teamAllowsModel('swift'); out.core = _teamAllowsModel('core'); out.auto = _teamAllowsModel('auto');
    out.sel = _sectionModelSelect('Research', 'tmp-sel');
    return out;
  });
  ok(r.forge === false && r.swift === true && r.core === true && r.auto === true, 'Forge is off; Swift, Core and Auto are on', r);
  ok(/<option value="coding"[^>]*disabled[^>]*>[^<]*off for your team/.test(r.sel), 'the section engine select disables Forge and says why');
  await page.click('#inp-mdl-btn');
  await page.waitForSelector('.mp-item[data-mk="coding"]', { timeout: 5000 });
  const desc = await page.evaluate(() => document.querySelector('.mp-item[data-mk="coding"] .mp-desc').textContent);
  ok(desc === 'Turned off by your team', 'the menu marks Forge as turned off by the team', desc);
  const before = await page.evaluate(() => S.model);
  await page.click('.mp-item[data-mk="coding"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ model: S.model, toast: [...document.querySelectorAll('.toast, [role="status"]')].map(t => t.textContent).join(' | '), upsell: !!document.querySelector('#ovr .ob, .upg-modal') }));
  ok(after.model === before, 'choosing it does not switch to it', after.model);
  ok(/owner or an admin/.test(after.toast), 'it says who can turn it on', after.toast);
  ok(!after.upsell, 'and does not offer an upgrade that would not help');
}

section('A member sees which engines the team uses, and no controls');
{
  const t = JSON.parse(JSON.stringify(TEAM)); t.policy = { engines: ['amv-swift'] };
  await serve(t, 'bob@x.com');
  await page.waitForFunction(() => /Your team uses/.test((document.getElementById('set-modal') || document.getElementById('vc')).textContent), null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ text: (document.getElementById('set-modal') || document.getElementById('vc')).textContent, save: !!document.getElementById('team-eng-save') }));
  ok(/Your team uses AMV Pulse, AMV Core, AMV Swift/.test(r.text), 'it lists them by name', r.text.match(/Your team uses[^.]*/)?.[0]);
  ok(!r.save, 'and there is nothing to change');
}

section('Nothing overflows on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(TEAM, 'owner@x.com');
  await page.waitForSelector('#team-eng-save', { timeout: 15000 });
  await page.click('input[name="team-eng-mode"][value="some"]');
  const over = await overflowingElement(page);
  ok(!over, 'nothing on the screen runs past the edge at 390px', over);
  await page.setViewportSize({ width: 1280, height: 800 });
}

section('With no team rule, nothing is marked');
{
  await page.evaluate(() => { _teamEngines = null; });
  const r = await page.evaluate(() => MODEL_ORDER.every(k => _teamAllowsModel(k)));
  ok(r, 'every engine is allowed');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('your-team-chooses-its-engines') > 0) process.exitCode = 1;
done();
