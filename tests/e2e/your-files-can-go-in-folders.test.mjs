/* YOUR FILES CAN GO IN FOLDERS - THE SAME FOLDER ON EVERY DEVICE.

   A file is moved from its row: Move, a folder name (or one already there),
   Save. The account is moved first, so if that fails nothing moves and a file
   is never in one folder here and another on the phone. A file the account
   has is shown in the account's folder - a move made on another device is the
   newer answer. One only on this device moves here and asks nothing of the
   server. The chips at the top show only what is in a folder, a folder
   counting what is inside its own folders.

   The server is stubbed at its routes; its own behaviour (the folder rule,
   the read-back, nobody else's file) is held by
   tests/worker/your-files-are-in-your-account. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();

const server = { files: [{ id: 'lfremote1', sig: 'text|laptop.txt|11|x', kind: 'text', name: 'laptop.txt', size: 11, chars: 11, added: 1, used: 2, folder: '' }],
                 bodies: { lfremote1: 'from laptop' }, puts: [], moves: [], failMove: false };
await page.route('**/v1/library**', async (route) => {
  const u = new URL(route.request().url());
  const J = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname.endsWith('/v1/library'))
    return J({ ok: true, configured: true, files: server.files, used: { files: server.files.length, bytes: 0 }, limit: { files: 100, bytes: 1e9 } });
  if (u.pathname.endsWith('/put')) { const b = JSON.parse(route.request().postData()); server.puts.push(b);
    const f = { id: 'lfup' + server.puts.length, sig: b.sig, kind: b.kind, name: b.name, chars: b.body.length, folder: b.folder || '' };
    server.files.push(f); server.bodies[f.id] = b.body; return J({ ok: true, file: f, verified: true }); }
  if (u.pathname.endsWith('/move')) { const b = JSON.parse(route.request().postData()); server.moves.push(b);
    if (server.failMove) return J({ error: 'busy', message: 'Your files are being changed somewhere else. Nothing was moved - try again in a moment.' }, 503);
    for (const f of server.files) if (b.ids.includes(f.id)) f.folder = b.folder;
    return J({ ok: true, moved: b.ids.length, folder: b.folder, verified: true }); }
  return J({ error: 'x' }, 404);
});

const open = async () => {
  await page.evaluate(() => openFileLibrary());
  await page.waitForFunction(() => { const b = document.getElementById('lib-body'); return b && !/Loading/.test(b.textContent); });
  await page.waitForTimeout(150);
  return page.evaluate(() => document.getElementById('lib-body').innerText);
};
const chips = () => page.evaluate(() => [...document.querySelectorAll('#lib-folders [data-lib-folder]')]
  .map(b => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), on: b.getAttribute('aria-pressed') === 'true' })));
const rows = () => page.evaluate(() => [...document.querySelectorAll('#lib-body .shelf-row .shelf-name')].map(n => n.textContent));
const localFolder = (name) => page.evaluate(async (n) => { const f = ((await _libAll()) || []).find(x => x.name === n); return f ? (f.folder || '') : null; }, name);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast, #toast, [role="alert"]')].map(t => t.textContent).join(' | '));
async function move(name, folder, { key } = {}) {
  await page.evaluate((n) => { const b = [...document.querySelectorAll('[data-lib-mv]')].find(x => x.closest('.shelf-row').textContent.includes(n)); b.click(); }, name);
  await page.waitForSelector('#lib-mv-in');
  await page.fill('#lib-mv-in', folder);
  if (key) await page.press('#lib-mv-in', key); else await page.click('#lib-mv-go');
  await page.waitForTimeout(400);
}

section('With nothing in a folder, there are no folder chips to read past');
{
  await page.evaluate(async () => { await _libKeep({ kind: 'text', name: 'receipt.txt', data: 'a receipt', size: 9 }); });
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await _libKeep({ kind: 'text', name: 'draft.txt', data: 'a draft', size: 7 }); });
  await page.waitForTimeout(300);
  server.files = server.files.filter(f => f.name !== 'draft.txt');   // this one stays on this device only
  const t = await open();
  ok(/receipt\.txt/.test(t) && /laptop\.txt/.test(t) && /draft\.txt/.test(t), 'every file is listed', t);
  ok((await chips()).length === 0, 'and no chips', await chips());
  const mv = await page.evaluate(() => [...document.querySelectorAll('[data-lib-mv]')].map(b => b.getAttribute('aria-label')));
  ok(mv.length === 3 && mv.every(l => /^Move /.test(l)), 'every row has a Move with a name a screen reader can say', mv);
}

section('Moving a file the account has moves it there first, then here');
{
  await move('receipt.txt', ' Taxes / 2026 ');
  const cloudId = server.files.find(f => f.name === 'receipt.txt').id;
  ok(server.moves.length === 1 && server.moves[0].ids[0] === cloudId && server.moves[0].folder === 'Taxes/2026',
     'the account is asked to move it, by the account’s id, written the same way the server writes it', server.moves);
  ok(await localFolder('receipt.txt') === 'Taxes/2026', 'and this device’s copy is in the same folder', await localFolder('receipt.txt'));
  ok(/Moved to Taxes\/2026/.test(await toasts()), 'it says where it went', await toasts());
  const c = await chips();
  ok(c.map(x => x.t).join(',') === 'All files 3,Taxes 1,Taxes/2026 1,Not in a folder 2',
     'the chips show each folder with what is in it, a folder counting its own folders', c);
  const t = await page.evaluate(() => document.getElementById('lib-body').innerText);
  ok(/receipt\.txt[\s\S]*Taxes\/2026/.test(t), 'and the row says which folder it is in', t);
}

section('A folder chip shows what is in it, and says it is chosen');
{
  await page.evaluate(() => document.querySelector('[data-lib-folder="Taxes"]').click());
  await page.waitForTimeout(250);
  ok(JSON.stringify(await rows()) === '["receipt.txt"]', 'Taxes shows the file in Taxes/2026', await rows());
  ok((await chips()).find(x => x.t.startsWith('Taxes ')).on === true, 'and is pressed', await chips());
  await page.evaluate(() => document.querySelector('[data-lib-folder=""]').click());
  await page.waitForTimeout(250);
  ok(JSON.stringify((await rows()).sort()) === '["draft.txt","laptop.txt"]', 'Not in a folder shows the rest', await rows());
  await page.evaluate(() => document.querySelector('[data-lib-folder="\u0000all"]').click());
  await page.waitForTimeout(250);
  ok((await rows()).length === 3, 'All files shows everything again', await rows());
}

section('A folder the server would refuse is refused here, and nothing is sent');
{
  const n = server.moves.length;
  await move('laptop.txt', 'a/b/c/d');
  ok(server.moves.length === n, 'no move was asked for', server.moves.length);
  ok(/up to three names/.test(await toasts()), 'and it says what a folder can be', await toasts());
  ok(await page.$('#lib-mv-in') !== null, 'the box stays open to fix it', true);
  await page.press('#lib-mv-in', 'Escape');
  await page.waitForTimeout(250);
  ok(await page.$('#lib-mv-in') === null && await page.$('#lib-body') !== null, 'Escape puts the row back and leaves the library open', true);
}

section('If the account will not move it, nothing moves');
{
  server.failMove = true;
  const n = server.moves.length;
  await move('receipt.txt', 'Work');
  ok(server.moves.length === n + 1, 'the account was asked', server.moves.length - n);
  ok(await localFolder('receipt.txt') === 'Taxes/2026', 'and this device’s copy stayed where it was', await localFolder('receipt.txt'));
  ok(/Nothing was moved/.test(await toasts()), 'and the reason is said', await toasts());
  server.failMove = false;
  await open();
}

section('A file only on this device moves here, and asks nothing of the server');
{
  const n = server.moves.length;
  await move('draft.txt', 'Drafts', { key: 'Enter' });
  ok(server.moves.length === n, 'no move was sent for a file the account does not have', server.moves.slice(n));
  ok(await localFolder('draft.txt') === 'Drafts', 'Enter saved it', await localFolder('draft.txt'));
}

section('A file in the account only moves there; a move made elsewhere is the one shown');
{
  await move('laptop.txt', 'Home');
  ok(server.moves.at(-1).ids[0] === 'lfremote1' && server.files.find(f => f.id === 'lfremote1').folder === 'Home', 'the account copy moved', server.moves.at(-1));
  server.files.find(f => f.name === 'receipt.txt').folder = 'Paid';   // another device moved it
  await open();
  const t = await page.evaluate(() => document.getElementById('lib-body').innerText);
  ok(/receipt\.txt[\s\S]*Paid/.test(t) && !/Taxes\/2026/.test(t), 'the account’s folder wins over this device’s older one', t);
  await move('receipt.txt', '');
  ok(server.files.find(f => f.name === 'receipt.txt').folder === '' && await localFolder('receipt.txt') === '', 'an empty box takes it out of every folder', server.moves.at(-1));
  ok(/Taken out of its folder/.test(await toasts()), 'and says so', await toasts());
}

section('In Spanish, the folder words are Spanish');
{
  await page.evaluate(async () => { saveStr('amv_lang', 'es'); try { _translateUI(); } catch (e) {} for (let i = 0; i < 50 && !_i18nPackHave('es'); i++) await new Promise(s => setTimeout(s, 100)); });
  await open();
  const c = (await chips()).map(x => x.t).join(',');
  ok(/Todos los archivos/.test(c) && /Sin carpeta/.test(c), 'the chips', c);
  const mv = await page.evaluate(() => document.querySelector('[data-lib-mv]').textContent);
  ok(mv === 'Mover', 'and Move', mv);
  await page.evaluate(() => { saveStr('amv_lang', 'en'); try { _translateUI(); } catch (e) {} });
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('your-files-can-go-in-folders') > 0) process.exitCode = 1;
done();
