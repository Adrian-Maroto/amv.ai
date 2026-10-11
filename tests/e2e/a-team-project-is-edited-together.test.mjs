/* A TEAM PROJECT IS EDITED TOGETHER.

   Shared editing, in a real browser, with AMV's server stood in for inside the
   page by one that keeps a revision the way the real one does (the server's
   half is proved in tests/worker/a-team-edits-one-project-together):

   - somebody in a team can share a project for editing, and from then on the
     project page says it is shared, at which version, changed by whom;
   - a colleague's change reaches this person's copy when the project opens,
     and their chats are told the instructions as the team's;
   - a change made here goes to the team;
   - when a colleague saved first, nothing is overwritten: both versions are
     shown, and "Keep theirs" or "Save mine over it" does exactly that;
   - a file added here goes to the team too;
   - earlier instructions can be restored, as a new version;
   - the team page lists shared projects, and opening one that is not on this
     device yet makes the person's copy of it;
   - a project the team stopped sharing stays as a personal one, and says so;
   - somebody not in a team is not offered any of it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ann', email: 'ann@x.com', ini: 'A' } });
const { page, errors } = app;

await page.evaluate(() => {
  /* The server: one record per project, a revision, refusals on a stale one. */
  const db = window.__db = {};
  window.__calls = [];
  const reply = (status, d) => ({ ok: status < 300, status, json: async () => d });
  window.__colleague = (id, patch) => { const p = db[id]; if(p.instructions !== patch.instructions) p.history.unshift({ rev: p.rev, by: p.updatedBy, at: p.updated, instructions: p.instructions });
    Object.assign(p, patch, { rev: p.rev + 1, updatedBy: 'ben@x.com', updated: Date.now() }); };
  window.AMVTeam.enabled = () => true;
  window.AMV_API._fetch = async (path, init) => {
    const b = init && init.body ? JSON.parse(init.body) : {};
    window.__calls.push(path);
    if (path === '/team/project/create') {
      const id = 'tp_' + (Object.keys(db).length + 1);
      db[id] = { id, name: b.name, icon: b.icon, instructions: b.instructions, files: b.files.map(f => Object.assign({}, f, { by: 'ann@x.com', at: Date.now() })),
        rev: 1, createdBy: 'ann@x.com', updatedBy: 'ann@x.com', updated: Date.now(), history: [] };
      return reply(200, { ok: true, project: JSON.parse(JSON.stringify(db[id])) });
    }
    if (path === '/team/project/get') return db[b.id] ? reply(200, { ok: true, project: JSON.parse(JSON.stringify(db[b.id])) }) : reply(404, { error: 'gone', code: 'gone' });
    if (path === '/team/project/save') {
      const p = db[b.id]; if (!p) return reply(404, { error: 'gone', code: 'gone' });
      if (b.baseRev !== p.rev) return reply(409, { error: 'conflict', code: 'conflict', project: JSON.parse(JSON.stringify(p)) });
      if (b.instructions !== undefined && b.instructions !== p.instructions) { p.history.unshift({ rev: p.rev, by: p.updatedBy, at: p.updated, instructions: p.instructions }); p.instructions = b.instructions; }
      if (b.files) p.files = b.files;
      Object.assign(p, { rev: p.rev + 1, updatedBy: 'ann@x.com', updated: Date.now() });
      return reply(200, { ok: true, project: JSON.parse(JSON.stringify(p)) });
    }
    if (path === '/team/project/list') return reply(200, { ok: true, projects: Object.values(db).map(p => ({ id: p.id, name: p.name, icon: p.icon, rev: p.rev, updated: p.updated, updatedBy: p.updatedBy })) });
    if (path === '/team/project/delete') { delete db[b.id]; return reply(200, { ok: true }); }
    return reply(200, { ok: true });
  };
  const ws = { id: 'wsA', name: 'Clinic', icon: '\u{1F9B7}', created: Date.now(), convs: [], memory: [], instructions: 'Answer in French.' };
  S.workspaces = [ws].concat(S.workspaces || []);
  _saveWorkspaces(S.workspaces);
  _projSaveFiles('wsA', [{ id: 'pf1', name: 'prices.txt', text: 'Cleaning 60 EUR', added: Date.now() }]);
});
const ws = () => page.evaluate(() => JSON.parse(JSON.stringify(_wsById('wsA'))));
const open = async () => { await page.evaluate(() => openProjectPanel('wsA')); };
const status = () => page.waitForFunction(() => { const e = document.querySelector('#pj-team .tp-box'); return e && !/Checking for changes/.test(e.innerText) && e.innerText; }, null, { timeout: 8000 }).then(h => h.jsonValue());

section('Somebody in a team shares a project for editing');
{
  await open();
  await page.waitForSelector('#tp-share', { timeout: 15000 });
  await page.click('#tp-share');
  const text = await status();
  const w = await ws();
  ok(w.team && w.team.rev === 1 && /Shared with your team/.test(text) && /Version 1/.test(text), 'the page says it is shared, at version 1', text);
  const server = await page.evaluate(() => Object.values(window.__db)[0]);
  ok(server.instructions === 'Answer in French.' && server.files[0].text === 'Cleaning 60 EUR', 'its instructions and files went to the team', server);
}

section('A colleague’s change arrives when the project opens');
{
  await page.evaluate(() => window.__colleague('tp_1', { instructions: 'Answer in French. Prices in euros.' }));
  await open();
  await page.waitForFunction(() => /euros/.test((document.getElementById('pj-instr') || {}).value || ''), null, { timeout: 8000 });
  const text = await status();
  ok(/Version 2/.test(text) && /ben/.test(text), 'it shows version 2, changed by the colleague', text);
  const ctx = await page.evaluate(() => { const c = newConvObj('t'); c.wsId = 'wsA'; S.convs.unshift(c); S.cur = c.id; return _projectContext(); });
  ok(/shared by the person’s team/.test(ctx) && /Prices in euros/.test(ctx) && /Cleaning 60 EUR/.test(ctx), 'and chats in it are told the team’s instructions and files', ctx.slice(0, 300));
}

section('A change made here goes to the team');
{
  await page.fill('#pj-instr', 'Answer in French. Prices in euros. Be brief.');
  await page.click('#pj-save');
  await page.waitForFunction(() => /Be brief/.test(window.__db.tp_1.instructions), null, { timeout: 8000 });
  ok((await ws()).team.rev === 3, 'saved as version 3 for everyone');
}

section('When a colleague saved first, nothing is overwritten - and the person chooses');
{
  await page.evaluate(() => window.__colleague('tp_1', { instructions: 'THEIRS' }));
  await page.fill('#pj-instr', 'MINE');
  await page.click('#pj-save');
  await page.waitForSelector('.tp-conflict', { timeout: 8000 });
  const box = await page.evaluate(() => document.querySelector('.tp-conflict').innerText);
  ok(/THEIRS/.test(box) && /MINE/.test(box) && /Nothing has been overwritten/.test(box), 'both versions are shown', box);
  ok(await page.evaluate(() => window.__db.tp_1.instructions === 'THEIRS'), 'and the colleague’s version is still the team’s');
  await page.click('#tp-theirs');
  await page.waitForFunction(() => (document.getElementById('pj-instr') || {}).value === 'THEIRS', null, { timeout: 8000 });
  ok((await ws()).instructions === 'THEIRS', 'Keep theirs: this copy now matches the team');

  await page.evaluate(() => window.__colleague('tp_1', { instructions: 'THEIRS AGAIN' }));
  await page.fill('#pj-instr', 'MINE AFTER ALL');
  await page.click('#pj-save');
  await page.waitForSelector('#tp-mine', { timeout: 8000 });
  await page.click('#tp-mine');
  await page.waitForFunction(() => window.__db.tp_1.instructions === 'MINE AFTER ALL', null, { timeout: 8000 });
  ok(await page.evaluate(() => window.__db.tp_1.history.some(h => h.instructions === 'THEIRS AGAIN')), 'Save mine over it: saved knowingly, and theirs is in the history');
}

section('A file added here goes to the team');
{
  await page.setInputFiles('#pj-file', { name: 'hours.txt', mimeType: 'text/plain', buffer: Buffer.from('Open 9 to 5, Monday to Friday.') });
  await page.waitForFunction(() => (window.__db.tp_1.files || []).some(f => f.name === 'hours.txt'), null, { timeout: 8000 });
  ok(true, 'the team has the new file');
}

section('Earlier instructions can be restored, as a new version');
{
  await open();
  await status();
  await page.evaluate(() => document.querySelector('.tp-hist').open = true);
  const before = await page.evaluate(() => window.__db.tp_1.rev);
  await page.click('[data-tp-restore="0"]');
  await page.waitForFunction((b) => window.__db.tp_1.rev === b + 1, before, { timeout: 8000 });
  ok(await page.evaluate(() => window.__db.tp_1.instructions !== 'MINE AFTER ALL'), 'the older text is the team’s again, one version later');
}

section('The team page lists shared projects; opening one makes this person’s copy');
{
  await page.evaluate(() => { window.__db.tp_9 = { id: 'tp_9', name: 'Sales playbook', instructions: 'Always offer a demo.', files: [], rev: 4, createdBy: 'ben@x.com', updatedBy: 'ben@x.com', updated: Date.now(), history: [] };
    closeOvr(); const el = document.createElement('div'); el.id = 'tp-list-probe'; document.body.appendChild(el); return _tpTeamList(el); });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#tp-list-probe .tsr-main b')].map(b => b.textContent));
  ok(rows.includes('Sales playbook') && rows.includes('Clinic'), 'both shared projects are listed', rows);
  /* The probe list sits outside any screen, under the page's own bars, so its
     button is pressed directly; on the team page it is an ordinary row. */
  await page.evaluate(() => { document.querySelector('#tp-list-probe [data-tp-open="tp_9"]').click(); document.getElementById('tp-list-probe').remove(); });
  await page.waitForFunction(() => /offer a demo/.test((document.getElementById('pj-instr') || {}).value || ''), null, { timeout: 8000 });
  const mirror = await page.evaluate(() => S.workspaces.find(w => w.team && w.team.id === 'tp_9'));
  ok(mirror && mirror.team.rev === 4 && mirror.name === 'Sales playbook', 'opening it made a copy here, up to date', mirror && mirror.team);
}

section('A project the team stopped sharing stays as a personal one');
{
  await page.evaluate(() => { delete window.__db.tp_1; closeOvr(); });
  await open();
  await page.waitForFunction(() => /removed from the team/.test((document.getElementById('pj-team') || {}).innerText || ''), null, { timeout: 8000 });
  const w = await ws();
  ok(!w.team && /THEIRS|MINE|French/.test(w.instructions), 'it is still here, as a personal project, and says why', w.instructions);
}

section('Somebody not in a team is not offered it');
{
  await page.evaluate(() => { window.AMVTeam.enabled = () => false; closeOvr(); window.__calls.length = 0; });
  await open();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ html: document.getElementById('pj-team').innerHTML, calls: window.__calls.slice() }));
  ok(r.html === '' && r.calls.length === 0, 'no team section, and nothing sent', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-team-project-is-edited-together') > 0) process.exitCode = 1;
done();
