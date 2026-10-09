/* A FILE SENT ONCE CAN BE USED AGAIN.

   The gap list's File Library: everything a person has sent AMV in a chat is
   kept on this device, and the paperclip offers it back - to a new chat, or to
   a project - without finding it on disk again. Driven through the real
   controls: the paperclip's menu, the file input, Send, the library's buttons.
   What is asserted is what AMV would send the engine (its seam, `_callAI`, is
   recorded), so "attached" means the document's text or the picture's bytes
   really went, not that a chip was drawn.

   And what it must not do: keep anything from a temporary chat, show one
   account's files to another, survive "erase this device", or crowd out saved
   chats - it lives in IndexedDB for that reason, which is checked too. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { docx } from '../lib/office-fixtures.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();

await page.evaluate(() => {
  window.__sent = null;
  window._callAI = async (msgs) => { window.__sent = msgs[msgs.length - 1]; S.busy = false; };
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
});

/* A real 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const lib = () => page.evaluate(async () => ((await _libAll()) || []).map(f => ({ name: f.name, kind: f.kind })));
const libSettles = async (n) => { for (let i = 0; i < 40; i++) { const l = await lib(); if (l.length === n) return l; await page.waitForTimeout(100); } return lib(); };
const sentText = () => page.evaluate(() => { const m = window.__sent; if (!m) return ''; return typeof m.c === 'string' ? m.c : JSON.stringify(m.c); });
const upload = async (files) => { await page.setInputFiles('#fi', files); await page.waitForSelector('#ab2', { state: 'visible', timeout: 5000 }); };
const send = (t) => page.evaluate(async (text) => { window.__sent = null; document.getElementById('mta').value = text; await sendMsg(); }, t);
const openLibrary = async () => {
  await page.click('#att-btn');
  await page.click('.ctxm [data-att="library"]');
  await page.waitForSelector('#lib-body .shelf-row, #lib-body .shelf-empty:not(:empty)', { timeout: 5000 });
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('lib-body').textContent));
};

section('Before anything is sent, the library says so');
{
  await openLibrary();
  const t = await page.evaluate(() => document.getElementById('lib-body').textContent);
  ok(/Nothing yet/.test(t), 'an empty library explains how files arrive', t);
  await page.evaluate(() => closeOvr());
}

section('A document sent in a chat is kept');
{
  await upload([{ name: 'plan.docx', mimeType: 'application/octet-stream', buffer: docx() }]);
  await send('Summarise this');
  ok(/Quarterly plan/.test(await sentText()), 'the first send carried the document', (await sentText()).slice(0, 80));
  const l = await libSettles(1);
  ok(l.length === 1 && l[0].name === 'plan.docx' && l[0].kind === 'text', 'and the library now holds it', l);
}

section('In a new chat, the paperclip attaches it again - the same text is sent');
{
  await page.evaluate(() => newChat());
  await page.click('#att-btn');
  const items = await page.evaluate(() => [...document.querySelectorAll('.ctxm [data-att]')].map(b => b.textContent));
  ok(items.length === 2 && /Upload/.test(items[0]) && /Your files/.test(items[1]), 'the paperclip offers upload and your files', items);
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.querySelector('.ctxm')), 'and Escape closes that menu');
  await openLibrary();
  await page.click('[data-lib-use]');
  const chip = await page.evaluate(() => document.getElementById('ac').textContent);
  ok(/plan\.docx/.test(chip) && /Word document/.test(chip), 'the chip shows the file, read as before', chip);
  await send('What is the budget?');
  const s = await sentText();
  ok(/plan\.docx/.test(s) && /Quarterly plan/.test(s) && /eighty thousand/.test(s), 'and the message carries the document’s text', s.slice(0, 120));
  const l = await libSettles(1);
  ok(l.length === 1, 'sending the same file again does not make a second copy', l);
}

section('A picture comes back as the same picture');
{
  await upload([{ name: 'receipt.png', mimeType: 'image/png', buffer: PNG }]);
  await send('What is this?');
  await libSettles(2);
  await page.evaluate(() => newChat());
  await openLibrary();
  const first = await page.evaluate(() => document.querySelector('#lib-body .shelf-name').textContent);
  ok(first === 'receipt.png', 'the most recently used file is listed first', first);
  await page.click('[data-lib-use]');
  await send('And now?');
  const b64 = await page.evaluate(() => { const c = window.__sent && window.__sent.c; const img = Array.isArray(c) && c.find(x => x.type === 'image'); return img ? img.source.data : ''; });
  ok(b64 === PNG.toString('base64'), 'the engine is sent the original bytes', b64.slice(0, 20));
}

section('Several files sent together are kept one by one');
{
  await page.evaluate(() => newChat());
  await upload([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha notes') }, { name: 'b.md', mimeType: 'text/markdown', buffer: Buffer.from('# beta') }]);
  await send('Compare');
  const l = await libSettles(4);
  ok(l.some(f => f.name === 'a.txt') && l.some(f => f.name === 'b.md') && !l.some(f => /,/.test(f.name)), 'each file has its own entry, not one combined one', l.map(f => f.name));
}

section('A temporary chat adds nothing');
{
  await page.evaluate(() => startTempChat());
  await upload([{ name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from('a private thing') }]);
  await send('Read this');
  ok(/a private thing/.test(await sentText()), 'the file was sent', '');
  await page.waitForTimeout(500);
  const l = await lib();
  ok(!l.some(f => f.name === 'secret.txt') && l.length === 4, 'and it is not in the library', l.map(f => f.name));
  await page.evaluate(() => newChat());
}

section('Search, and delete');
{
  await openLibrary();
  await page.fill('#lib-q', 'plan');
  await page.waitForFunction(() => document.querySelectorAll('#lib-body .shelf-row').length === 1);
  ok(true, 'searching narrows the list to the match');
  await page.fill('#lib-q', '');
  await page.waitForFunction(() => document.querySelectorAll('#lib-body .shelf-row').length === 4);
  await page.evaluate(() => [...document.querySelectorAll('#lib-body .shelf-row')].find(r => /receipt\.png/.test(r.textContent)).querySelector('[data-lib-rm]').click());
  const l = await libSettles(3);
  ok(l.length === 3 && !l.some(f => f.name === 'receipt.png'), 'Delete removes that file from the device', l.map(f => f.name));
  await page.waitForFunction(() => document.querySelectorAll('#lib-body .shelf-row').length === 3);
}

section('A project can take a document from here; pictures are not offered');
{
  await page.evaluate(() => {
    _saveWorkspaces([{ id: 'wsL', name: 'Library test', icon: '📁', created: Date.now(), updated: Date.now(), memory: [] }].concat(S.workspaces || []));
    openProjectPanel('wsL');
  });
  await page.click('#pj-lib');
  await page.waitForSelector('#lib-body .shelf-row');
  /* A picture, back in the library, to prove the project list leaves it out. */
  await page.evaluate(() => _libKeep({ kind: 'img', name: 'photo.png', size: 10, b64: 'iVBORw0KGgo=', mime: 'image/png' }));
  await page.fill('#lib-q', ' ');
  await page.fill('#lib-q', '');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('lib-body').textContent));
  const names = await page.evaluate(() => [...document.querySelectorAll('#lib-body .shelf-name')].map(n => n.textContent));
  ok(names.includes('plan.docx') && !names.includes('photo.png'), 'only documents are listed for a project', names);
  await page.evaluate(() => [...document.querySelectorAll('#lib-body .shelf-row')].find(r => /plan\.docx/.test(r.textContent)).querySelector('[data-lib-use]').click());
  await page.waitForSelector('#pj-body');
  const files = await page.evaluate(() => _projFiles('wsL').map(f => f.name + ':' + /Quarterly plan/.test(f.text)));
  ok(files.length === 1 && files[0] === 'plan.docx:true', 'and the project now has the document’s text', files);
  await page.evaluate(() => closeOvr());
}

section('Delete all asks first, and Cancel keeps everything');
{
  await openLibrary();
  await page.click('#lib-clear');
  await page.click('#cfm-no');
  await page.waitForSelector('#lib-body .shelf-row');
  ok((await lib()).length === 4, 'Cancel deleted nothing, and the library came back', (await lib()).length);
  await page.click('#lib-clear');
  await page.click('#cfm-yes');
  const l = await libSettles(0);
  ok(l.length === 0, 'confirming deletes every file', l.length);
  await page.evaluate(() => closeOvr());
}

section('Bounded: past the limit, the least recently used leave');
{
  const r = await page.evaluate(async () => {
    for (let i = 0; i < LIB_MAX_FILES + 5; i++) await _libKeep({ kind: 'text', name: 'n' + i + '.txt', size: 4, data: 'note ' + i });
    const all = await _libAll();
    return { n: all.length, hasOldest: all.some(f => f.name === 'n0.txt'), hasNewest: all.some(f => f.name === 'n' + (LIB_MAX_FILES + 4) + '.txt') };
  });
  ok(r.n === 200 && !r.hasOldest && r.hasNewest, 'it holds 200 files and drops the oldest', r);
}

section('It is kept apart from saved chats, and per account');
{
  const r = await page.evaluate(async () => {
    const inLocal = Object.keys(localStorage).some(k => /note 1/.test(localStorage.getItem(k) || ''));
    const dbs = (await indexedDB.databases()).map(d => d.name);
    S.user = { name: 'Lee', email: 'lee@example.com', ini: 'L' };
    const lee = (await _libAll()).length;
    S.user = { name: 'Kim', email: 'kim@example.com', ini: 'K' };
    const kim = (await _libAll()).length;
    return { inLocal, dbs, lee, kim };
  });
  ok(!r.inLocal && r.dbs.includes('amv_files:kim@example.com'), 'the files are in their own database, not in localStorage', r.dbs);
  ok(r.lee === 0 && r.kim === 200, 'another account on this browser sees none of them', r);
}

section('Erasing this device removes them');
{
  const dbs = await page.evaluate(async () => {
    eraseDeviceData('kim@example.com');
    await new Promise(res => setTimeout(res, 400));
    return (await indexedDB.databases()).map(d => d.name);
  });
  ok(!dbs.includes('amv_files:kim@example.com'), 'the library’s database is gone', dbs);
}

section('Where the browser keeps nothing, it says so and sending still works');
{
  const r = await page.evaluate(async () => {
    _libForget();
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    openFileLibrary();
    await new Promise(res => setTimeout(res, 200));
    const text = document.getElementById('lib-body').textContent;
    closeOvr();
    return { text, kept: await _libKeep({ kind: 'text', name: 'x.txt', size: 1, data: 'x' }) };
  });
  ok(/not letting AMV keep files/.test(r.text), 'the library explains why it is empty', r.text);
  ok(r.kept === false, 'and keeping a file quietly does nothing rather than failing the send');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('your-files-come-back') > 0) process.exitCode = 1;
done();
