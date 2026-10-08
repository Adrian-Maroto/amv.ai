/* A PROJECT IS WHAT THE SCREEN SAYS IT IS.

   "AMV remembers everything inside it" was printed on a project that was a
   name, an icon and a tag; no chat inside one received anything a chat outside
   it did not. Checked here at the only place that decides it - the request a
   chat in a project actually sends - and at the storage bug found on the way,
   where projects were written under one name and read from another. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { docx } from '../lib/office-fixtures.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  window._aiBackendReady = () => true;
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
  window.__bodies = [];
  window.fetch = async (u, o) => { try { window.__bodies.push(JSON.parse(o.body)); } catch (e) {} throw new Error('offline for the test'); };
  window.__sysOf = () => { const b = window.__bodies[window.__bodies.length - 1] || {}; return typeof b.system === 'string' ? b.system : JSON.stringify(b.system || ''); };
  S.memory = [{ id: 'g1', text: 'Prefers short answers', added: Date.now() }];
  _saveWorkspaces([{ id: 'wsA', name: 'Lyon clinic', icon: '🦷', desc: '', created: Date.now(), updated: Date.now(),
                     instructions: 'Answer in French. Cite the 2024 guidelines.', memory: [] }].concat(S.workspaces || []));
});
const send = (text) => page.evaluate(async (t) => {
  window.__bodies.length = 0;
  setMsgs(getMsgs().concat([{ r: 'u', c: t }]));
  try { await _callAITurn(getMsgs()); } catch (e) {}
  S.busy = false;
  return { sent: window.__bodies.length, sys: window.__sysOf() };
}, text);

section('A chat in a project is sent the project');
{
  await page.evaluate(() => newChatInProject('wsA'));
  const r = await send('What should I tell a patient about whitening?');
  ok(r.sent > 0, 'the turn really went out', r.sent);
  ok(/PROJECT: Lyon clinic/.test(r.sys) && /Answer in French\. Cite the 2024 guidelines\./.test(r.sys),
     'with the project and its instructions', r.sys.slice(0, 200));
  const banner = await page.evaluate(() => (document.querySelector('.pj-banner') || {}).textContent || '');
  ok(/Lyon clinic/.test(banner) && /instructions/.test(banner), 'and the chat says it is using them', banner);
}

section('A chat outside the project is not');
{
  await page.evaluate(() => newChat());
  const r = await send('Hello');
  ok(r.sent > 0 && !/Lyon clinic|Answer in French/.test(r.sys), 'an ordinary chat carries none of it', r.sent);
}

section('Files added to the project are read for real and sent with it');
{
  await page.evaluate(() => openProjectPanel('wsA'));
  await page.setInputFiles('#pj-file', [{ name: 'plan.docx', mimeType: 'application/octet-stream', buffer: docx() },
                                         { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 7)]) }]);
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => ({ text: document.getElementById('pj-body').textContent, files: _projFiles('wsA').map(f => f.name) }));
  ok(panel.files.length === 1 && panel.files[0] === 'plan.docx', 'the Word document is kept; the audio file is refused', panel.files);
  ok(/Kept on this device/.test(panel.text), 'and the page says where the files live', panel.text.slice(0, 160));
  await page.evaluate(() => { closeOvr(); newChatInProject('wsA'); });
  const r = await send('Summarise our plan');
  ok(/=== plan\.docx ===/.test(r.sys) && /Quarterly plan/.test(r.sys), 'a chat in the project is sent the document’s text', r.sys.length);
}

section('Memory learned in a project stays in the project');
{
  const r = await page.evaluate(async () => {
    window._aiBackendReady = () => true;
    window.aiComplete = async () => '["The clinic opens at 8:30 on Saturdays"]';
    newChatInProject('wsA');
    setMsgs([{ r: 'u', c: 'a' }, { r: 'a', c: 'b' }, { r: 'u', c: 'c' }, { r: 'a', c: 'd' }, { r: 'u', c: 'We open 8:30 Saturdays' }, { r: 'a', c: 'Noted' }]);
    await _maybeExtractMemory(getMsgs());
    const ws = _wsById('wsA');
    return { proj: (ws.memory || []).map(m => m.text), global: S.memory.map(m => m.text) };
  });
  ok(r.proj.some(t => /8:30/.test(t)), 'the fact is kept on the project', r.proj);
  ok(!r.global.some(t => /8:30/.test(t)), 'and not added to the person’s general memory', r.global);
  const s = await send('When do we open on Saturday?');
  ok(/learned within this project: .*8:30/.test(s.sys), 'and the next chat in the project is told it', s.sys.slice(-300));
}

section('Projects are kept under one name, so a synced change survives a reload');
{
  const r = await page.evaluate(() => {
    /* A change that arrived by sync is persisted where the state layer writes;
       an older copy sits under the legacy name. Loading must keep the newer. */
    store('amv_workspaces', [{ id: 'wsA', name: 'Lyon clinic (renamed on the phone)', created: 1, updated: Date.now() + 5000 }]);
    store('amv_ws', [{ id: 'wsA', name: 'Lyon clinic', created: 1, updated: 10 }]);
    const list = _loadWorkspaces();
    _saveWorkspaces(list);
    return { name: (list.find(w => w.id === 'wsA') || {}).name, legacy: load('amv_ws') };
  });
  ok(r.name === 'Lyon clinic (renamed on the phone)', 'the newer copy wins on load', r.name);
  ok(r.legacy === null, 'and the legacy copy is retired so it cannot win next time', r.legacy);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-project-is-what-it-says') > 0) process.exitCode = 1;
done();
