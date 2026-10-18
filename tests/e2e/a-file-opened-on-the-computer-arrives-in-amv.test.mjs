/* A FILE OPENED ON THE COMPUTER ARRIVES IN AMV - AND IS NOT SENT.

   Installed on a computer, AMV is offered by the system as a way to open the
   files it reads (manifest file_handlers). The browser hands an opened file
   to launchQueue; it must arrive as a new chat with the file attached through
   the same door as the paperclip - read, held for editing if it is a Word
   file - and never be sent by itself. Checked in a real browser, with
   Chrome's own reading of the manifest, and with launchQueue stood in for
   because only an installed app receives a real one:

   - Chrome reads the file handlers with no complaint, inside the app's scope;
   - an opened Word file is a new chat with it attached, ready to edit, and
     nothing is sent; the address it arrived on is cleaned;
   - before sign-in it waits, and arrives once somebody is signed in;
   - a folder, or a file that cannot be read, is refused out loud;
   - the install card says it, on a computer only. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
const LEASE = [...readFileSync(join(ROOT, 'tests', 'fixtures', 'office', 'lease-docx.docx'))];

/* What only an installed app is given, stood in for before the app starts. */
/* Chrome has a launchQueue of its own (read-only, and silent outside an
   installed app), so the stand-in is defined over it rather than assigned. */
const standIn = () => { Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn){ window.__lq = fn; } } }); };
const open = (page, files) => page.evaluate(async (files) => {
  window.__toasts = [];
  const real = window.toast;
  window.toast = (m, k, ms) => { window.__toasts.push(String(m)); return real(m, k, ms); };
  await window.__lq({ files: files.map(f => f.dir ? { kind: 'directory', name: f.name }
    : { kind: 'file', name: f.name, getFile: async () => { if (f.broken) throw new Error('gone'); return new File([new Uint8Array(f.bytes)], f.name); } }) });
  await new Promise(r => setTimeout(r, 50));
}, files);

section('Chrome reads the file handlers, inside the app');
{
  const fh = (manifest.file_handlers || [])[0] || {};
  const exts = Object.values(fh.accept || {}).flat();
  ok(['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.txt', '.md'].every(e => exts.includes(e)), 'the files AMV reads, and only those', exts);
  ok(fh.action === '/?open=1' && fh.launch_type === 'single-client', 'opened into one window, at an address in the app’s scope', fh);
}

const app = await bootApp({ tab: 'chat', query: '?open=1', user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;
{
  const cdp = await page.context().newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  const complaints = (m.errors || []).map(e => e.message).filter(x => /file_handler|launch_type|accept|action/i.test(x));
  ok(/file_handlers/.test(m.data || '') && complaints.length === 0, 'and Chrome’s own reading of the manifest has no complaint about them', complaints);
  ok(await page.evaluate(() => location.search) === '', 'the address it arrives on is cleaned, so a reload opens nothing again', await page.evaluate(() => location.search));
}

section('An opened Word file is a new chat with it attached - and nothing is sent');
{
  await page.addInitScript(standIn);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__lq === 'function' && typeof goApp === 'function', null, { timeout: 15000 });
  /* Signed in again the way the harness does it, after the reload. */
  await page.evaluate(() => { S.user = { name: 'Kim', email: 'kim@example.com', ini: 'K' }; goApp(); setTab('chat'); document.getElementById('ck')?.remove(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { newChat(); document.getElementById('mta').value = ''; });
  const before = await page.evaluate(() => S.cur);
  await open(page, [{ name: 'lease.docx', bytes: LEASE }]);
  await page.waitForFunction(() => S.att && S.att.name === 'lease.docx', null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ cur: S.cur, att: { name: S.att.name, format: S.att.format, data: S.att.data },
    sent: (getMsgs() || []).length, held: !!_officeHeld('lease.docx'), chip: (document.getElementById('ac') || {}).textContent || '', toasts: window.__toasts }));
  ok(r.cur && r.cur !== before, 'it opens a new chat, not the one that was on screen', [before, r.cur]);
  ok(r.att.format === 'docx' && /The tenant pays monthly/.test(r.att.data), 'it is attached, and read as a Word document', r.att.format);
  ok(r.held, 'and held, so AMV can hand back an edited copy of it', r.held);
  ok(/lease\.docx/.test(r.chip), 'the attachment shows, as if the paperclip had been used', r.chip);
  ok(r.sent === 0, 'nothing was sent - an opened file is material, not an instruction', r.sent);
  ok(r.toasts.some(t => /Opened in a new chat/.test(t)), 'and it says what happened', r.toasts);
}

section('A folder, or a file that cannot be read, is refused out loud');
{
  await page.evaluate(() => { S.att = null; });
  await open(page, [{ name: 'Documents', dir: true }, { name: 'gone.docx', broken: true }]);
  const r = await page.evaluate(() => ({ att: S.att, toasts: window.__toasts }));
  ok(!r.att && r.toasts.some(t => /could not be read/.test(t)), 'nothing is attached, and it says why', r.toasts);
}

section('The install card says it, on a computer');
{
  const html = await page.evaluate(() => _appsCardHTML());
  ok(/open a Word, Excel, PowerPoint, PDF or text file with AMV/.test(html), 'a computer is told', html.length);
  const phone = await page.evaluate(() => { const real = _appPlatform; window._appPlatform = () => 'android'; try { return _appsCardHTML(); } finally { window._appPlatform = real; } });
  ok(!/open a Word, Excel/.test(phone), 'a phone is not', phone.length);
}
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();

section('Before sign-in it waits, and arrives once somebody is signed in');
{
  const out = await bootApp({ tab: 'chat', user: null });
  const p = out.page;
  await p.addInitScript(standIn);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => typeof window.__lq === 'function' && typeof goApp === 'function', null, { timeout: 15000 });
  await p.waitForTimeout(300);
  await open(p, [{ name: 'lease.docx', bytes: LEASE }]);
  const r1 = await p.evaluate(() => ({ att: !!S.att, toasts: window.__toasts }));
  ok(!r1.att && r1.toasts.some(t => /Sign in and the file you opened will be waiting/.test(t)), 'signed out: not attached, and told it will wait', r1);
  await p.evaluate(() => _applyLaunchIntent());
  ok(!(await p.evaluate(() => !!S.att)), 'starting the app again while still signed out does not attach it', true);
  await p.evaluate(() => { S.user = { name: 'Kim', email: 'kim@example.com', ini: 'K' }; _applyLaunchIntent(); });
  await p.waitForFunction(() => S.att && S.att.name === 'lease.docx', null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => !!(S.att && S.att.name === 'lease.docx' && (getMsgs() || []).length === 0)), 'signed in: it is there, in a new chat, unsent', true);
  ok(out.errors.length === 0, 'no JavaScript errors', out.errors.slice(0, 3));
  await out.close();
}

if (report('a-file-opened-on-the-computer-arrives-in-amv') > 0) process.exitCode = 1;
done();
