/* A FILE SHARED FROM ANOTHER APP ARRIVES IN AMV - AND IS NOT SENT.

   Installed on a phone, AMV is in the share sheet (manifest share_target).
   It used to take only words; a PDF, a photo or a Word file shared to it was
   dropped. Now the share arrives as a form post to /share, which the real
   service worker answers - checked here with the real worker in a real
   browser, posting exactly what a share sheet posts:

   - Chrome reads the share target, files included, with no complaint;
   - the worker parks the file on the device and sends the app the words;
   - the app opens ONE new chat with the file attached and the words in the
     box - nothing sent - and empties the inbox, so nothing shared waits on
     the device afterwards; a Word file is held for editing;
   - the address is cleaned, so a reload opens nothing again;
   - a share the worker could not read is said out loud, not dropped. */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
const LEASE = [...readFileSync(join(ROOT, 'tests', 'fixtures', 'office', 'lease-docx.docx'))];

section('The share target takes files as well as words');
{
  const st = manifest.share_target || {};
  const f = ((st.params || {}).files || [])[0] || {};
  ok(st.action === '/share' && st.method === 'POST' && st.enctype === 'multipart/form-data', 'a form post to /share, inside the app', st);
  ok(f.name === 'files' && ['application/pdf', 'image/*', '.docx', '.xlsx', '.pptx'].every(a => (f.accept || []).includes(a)), 'PDFs, pictures and Office files', f.accept);
}

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const signIn = () => page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  S.user = { name: 'Kim', email: 'kim@example.com', ini: 'K' }; goApp(); setTab('chat'); document.getElementById('ck')?.remove();
});
const inbox = () => page.evaluate(async () => { const b = await caches.open('amvshare-inbox'); return (await b.keys()).map(r => new URL(r.url).pathname); });

try {
  await page.goto(url, { waitUntil: 'load' });
  const controlled = await page.evaluate(async () => {
    for (let i = 0; i < 150; i++) { if (navigator.serviceWorker.controller) return true; await new Promise(r => setTimeout(r, 100)); }
    return false;
  });
  ok(controlled, 'the service worker is in charge of the page', controlled);
  const cdp = await ctx.newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  const complaints = (m.errors || []).map(e => e.message).filter(x => /share_target|enctype|files|accept/i.test(x));
  ok(/"share_target"/.test(m.data || '') && complaints.length === 0, 'and Chrome’s own reading of the manifest has no complaint about it', complaints);

  section('A Word file shared with a note: one new chat, the file attached, the note in the box');
  {
    const posted = await page.evaluate(async (bytes) => {
      const fd = new FormData();
      fd.append('title', 'Lease to check');
      fd.append('text', 'Is the rent date right?');
      fd.append('files', new File([new Uint8Array(bytes)], 'lease.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const r = await fetch('/share', { method: 'POST', body: fd });
      return { url: r.url, redirected: r.redirected, status: r.status };
    }, LEASE);
    ok(posted.redirected && /\/\?.*shared=[a-z0-9]+/.test(posted.url) && /text=Is\+the\+rent/.test(posted.url), 'the worker answers the share and sends the app on, with the words', posted);
    ok((await inbox()).length === 1, 'the file waits in the inbox for the app', await inbox());

    await page.goto(posted.url, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof goApp === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => location.search) === '', 'the address is cleaned at once, so a reload opens nothing again', await page.evaluate(() => location.search));
    await signIn();
    await page.waitForFunction(() => S.att && S.att.name === 'lease.docx', null, { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(() => ({ att: S.att && { name: S.att.name, format: S.att.format }, box: document.getElementById('mta').value,
      sent: (getMsgs() || []).length, held: !!_officeHeld('lease.docx') }));
    ok(r.att && r.att.format === 'docx', 'the file is attached, read as a Word document', r.att);
    ok(/Lease to check/.test(r.box) && /Is the rent date right\?/.test(r.box), 'the words it came with are in the box', r.box);
    ok(r.sent === 0, 'and nothing was sent - a share is material, not an instruction', r.sent);
    ok(r.held, 'a Word file is held, so AMV can hand back an edited copy', r.held);
    ok((await inbox()).length === 0, 'the inbox is empty: nothing shared waits on the device', await inbox());
  }

  section('A share the worker could not read is said, not dropped');
  {
    const posted = await page.evaluate(async () => {
      const r = await fetch('/share', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'not a form' });
      return r.url;
    });
    ok(/sharedfail=1/.test(posted), 'the worker says it could not read it', posted);
    await page.goto(posted, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof goApp === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { window.__toasts = []; const real = window.toast; window.toast = (m, k, ms) => { window.__toasts.push(String(m)); return real(m, k, ms); }; });
    await signIn();
    await page.waitForTimeout(600);
    const toasts = await page.evaluate(() => window.__toasts);
    ok(toasts.some(t => /The file you shared could not be read/.test(t)), 'and the app says so', toasts);
  }
} finally {
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
  await browser.close();
  server.close();
}
if (report('a-file-shared-from-another-app-arrives-in-amv') > 0) process.exitCode = 1;
done();
