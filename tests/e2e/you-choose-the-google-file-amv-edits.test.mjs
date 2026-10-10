/* YOU CHOOSE THE GOOGLE FILE AMV EDITS - IN GOOGLE'S OWN WINDOW.

   AMV edits Docs and Sheets on drive.file: the files it made, and the ones
   somebody chose for it in Google's picker. The picker runs in a window of its
   own (picker.html) so this page never loads Google's code. Checked in a real
   browser, with a real popup window, and Google itself stood in for in that
   window (there is no Google account in a test):

   - with the picker not set up, it says so - and that AMV can still edit the
     files it made - rather than opening a window that fails;
   - set up, it asks first, opens the window, and the file chosen there comes
     back as {fileId, name, type};
   - a message from any other window, or the page itself, is ignored - a
     forged "the person chose this file" is not a choice;
   - closing the window without choosing is "no file was chosen";
   - the picker window itself carries its own policy, and is the only place
     Google's hosts are allowed;
   - the Docs and Sheets actions send exactly what they were given to the
     server, and the edits are marked as needing approval. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

/* The window's own script, replaced by one that "picks" a file - the part
   that is Google's cannot run here. Everything on AMV's side is real. */
let pickScript = '';
await page.context().route(/\/picker\.js$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: pickScript }));

const serveCfg = (cfg) => page.evaluate((cfg) => {
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  AMV_API._fetch = async (path) => ({ ok: true, status: 200, json: async () => path === '/v1/google/picker' ? cfg : {} });
  window.__acts = [];
  AMV_API.connectAct = async (action, args) => { window.__acts.push({ action, args }); return { ok: true, result: { fine: true } }; };
}, cfg);
/* Answer AMV's own "Choose a file?" dialog with the button it shows. */
const answerDialog = (yes) => page.evaluate((yes) => new Promise(res => {
  const t = setInterval(() => {
    const ok = document.getElementById('modal-ok'), no = document.getElementById('modal-cancel');
    if (ok) { clearInterval(t); (yes ? ok : no).click(); res(true); }
  }, 50);
}), yes);
const pick = () => page.evaluate(() => _gPickFile().then(r => ({ r }), e => ({ e: e.message })));

section('Not set up: it says so, and opens nothing');
{
  await serveCfg({ ok: true, configured: false });
  const before = page.context().pages().length;
  const r = await pick();
  ok(/not switched on/.test(r.e || '') && /files it made itself/.test(r.e || ''), 'it says choosing is not on, and what still works', r);
  ok(page.context().pages().length === before, 'and no window was opened');
}

section('Set up: asked first, then the file chosen in Google’s window comes back');
{
  await serveCfg({ ok: true, configured: true, clientId: 'cid.apps.googleusercontent.com', apiKey: 'browser-key', appId: '123456789012' });
  pickScript = `window.opener.postMessage({ amvPicker: true, fileId: '1AbCdEfGhIjKlMnOp', name: 'Budget 2027', mimeType: 'application/vnd.google-apps.spreadsheet' }, location.origin);`;
  const popupP = page.context().waitForEvent('page');
  const res = pick();
  await answerDialog(true);
  const popup = await popupP;
  const r = await res;
  ok(r.r && r.r.fileId === '1AbCdEfGhIjKlMnOp' && r.r.name === 'Budget 2027' && r.r.type === 'sheet', 'the chosen file, its name and that it is a sheet', r);
  const hash = new URL(popup.url()).hash.slice(1);
  const sent = JSON.parse(decodeURIComponent(Buffer.from(hash, 'base64').toString('latin1')));
  ok(sent.clientId === 'cid.apps.googleusercontent.com' && sent.appId === '123456789012' && sent.hint === 'pat@example.com',
     'the window was given the public settings and who is signed in, in the fragment that never reaches a server', sent);
  ok(new URL(popup.url()).pathname === '/picker.html', 'and it is AMV’s own picker window', popup.url());
  await popup.close().catch(() => {});
}

section('A forged "the person chose this" from anywhere else is ignored');
{
  pickScript = `/* this window chooses nothing */`;
  const popupP = page.context().waitForEvent('page');
  const res = pick();
  await answerDialog(true);
  const popup = await popupP;
  await page.evaluate(() => window.postMessage({ amvPicker: true, fileId: '1ForgedForgedForged', name: 'x', mimeType: 'application/vnd.google-apps.document' }, '*'));
  await page.waitForTimeout(400);
  await popup.close();
  const r = await res;
  ok(r.e === 'No file was chosen.', 'the page’s own message was not taken as a choice, and closing the window chose nothing', r);
}

section('Saying no to the dialog opens nothing');
{
  const before = page.context().pages().length;
  const res = pick();
  await answerDialog(false);
  const r = await res;
  ok(r.e === 'No file was chosen.' && page.context().pages().length === before, 'declined, and no window', r);
}

section('The picker window has its own policy; the app’s does not allow Google’s code');
{
  const html = readFileSync(join(ROOT, 'src', 'picker', 'picker.html'), 'utf8');
  ok(/script-src 'self' https:\/\/apis\.google\.com https:\/\/accounts\.google\.com;/.test(html) && /default-src 'none'/.test(html),
     'the window allows Google’s sign-in and picker scripts, and nothing by default');
  const app = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const csp = (/Content-Security-Policy" content="([^"]+)"/.exec(app) || [])[1] || '';
  ok(csp && !/apis\.google\.com/.test(csp.split(';').find(d => /script-src/.test(d)) || ''), 'the app page’s script policy does not include Google’s picker host');
  const js = readFileSync(join(ROOT, 'src', 'picker', 'picker.js'), 'utf8');
  ok(/opener\.postMessage\(.*, location\.origin\)/.test(js) && !/postMessage\([^\n]*'\*'\)/.test(js) && /auth\/drive\.file'/.test(js) && !/auth\/drive'/.test(js),
     'the window posts only to AMV’s own origin, and asks Google for drive.file alone');
}

section('The Docs and Sheets actions send what they were given, and edits ask first');
{
  const r = await page.evaluate(async () => {
    window.__acts = [];
    await INTEGRATION_ACTIONS.google_doc_edit.run({ fileId: '1AbCdEfGhIjKlMnOp', replace: [{ find: 'old', with: 'new' }], append: 'P.S.' });
    await INTEGRATION_ACTIONS.google_sheet_write.run({ fileId: '1AbCdEfGhIjKlMnOp', range: 'Plan!A1', values: [['=SUM(B1:B2)']] });
    await INTEGRATION_ACTIONS.google_sheet_read.run({ fileId: '1AbCdEfGhIjKlMnOp', range: 'Plan!A1:B9' });
    return { acts: window.__acts, risk: [INTEGRATION_ACTIONS.google_doc_edit.risk, INTEGRATION_ACTIONS.google_sheet_write.risk,
                                       INTEGRATION_ACTIONS.google_doc_read.risk, INTEGRATION_ACTIONS.google_sheet_read.risk] };
  });
  ok(r.acts[0].action === 'docs.edit' && r.acts[0].args.replace[0].with === 'new' && r.acts[0].args.append === 'P.S.', 'a doc edit, as given', r.acts[0]);
  ok(r.acts[1].action === 'sheets.write' && r.acts[1].args.values[0][0] === '=SUM(B1:B2)', 'a sheet write, formula and all', r.acts[1]);
  ok(r.acts[2].action === 'sheets.read' && r.acts[2].args.range === 'Plan!A1:B9', 'a sheet read with its range', r.acts[2]);
  ok(r.risk[0] === 'high' && r.risk[1] === 'high' && !r.risk[2] && !r.risk[3], 'the two that change a file ask first; reading does not', r.risk);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('you-choose-the-google-file-amv-edits') > 0) process.exitCode = 1;
done();
