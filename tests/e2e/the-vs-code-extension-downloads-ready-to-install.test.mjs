/* THE VS CODE EXTENSION DOWNLOADS READY TO INSTALL, WITH THIS AMV IN IT.

   Settings > API keys packs amv.vsix in the browser from the two files this
   deployment publishes, writing its own address in as the server - so the
   only thing left to set in VS Code is the key. A .vsix is a zip that VS Code
   checks entry by entry, so the archive is read back here the way an
   unpacker reads it: every header, every size, every CRC. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { crc32 } from 'zlib';

const BASE = 'https://amv-stub.workers.dev';
const app = await bootApp({ tab: 'chat', apiBase: BASE });
const { page, errors } = app;

/* Unpack a stored (uncompressed) zip through its central directory. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = {}; let p = cdOff, bad = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) { bad.push('central header ' + i); break; }
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    if (buf.readUInt32LE(local) !== 0x04034b50) bad.push('local header ' + name);
    const lnlen = buf.readUInt16LE(local + 26), data = buf.slice(local + 30 + lnlen, local + 30 + lnlen + size);
    if (crc32(data) !== crc) bad.push('crc ' + name);
    out[name] = data.toString('utf8');
    p += 46 + nlen;
  }
  return { files: out, bad };
}

section('The archive is a valid extension package');
{
  const b64 = await page.evaluate(async () => {
    await _apiKeysLoad();
    const blob = _zipStored(await _vsixFiles('https://amv-stub.workers.dev'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  });
  const { files, bad } = unzip(Buffer.from(b64, 'base64'));
  ok(bad.length === 0, 'every header and every CRC checks out', bad);
  ok(['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/extension.js'].every(n => n in files),
     'with the four entries VS Code expects', Object.keys(files));
  const pkg = JSON.parse(files['extension/package.json']);
  ok(pkg.contributes.configuration.properties['amv.server'].default === BASE, 'this AMV’s address is the server', pkg.contributes.configuration.properties['amv.server'].default);
  ok(pkg.main === './extension.js' && /require\('vscode'\)/.test(files['extension/extension.js']), 'and the extension itself is inside', pkg.main);
  ok(/Microsoft\.VisualStudio\.Code\.Manifest/.test(files['extension.vsixmanifest']) && /Id="amv"/.test(files['extension.vsixmanifest']),
     'the manifest names it and points at its package.json', files['extension.vsixmanifest'].slice(0, 120));
}

section('Settings > API keys offers it, and a copy with no server says so');
{
  const r = await page.evaluate(async () => {
    const d = document.createElement('div'); document.body.appendChild(d);
    await _apiKeysLoad(); _renderApiKeysPane(d);
    const has = !!d.querySelector('#ak-vsix'); d.remove();
    return has;
  });
  ok(r, 'the button is on the API keys screen', r);
}

section('The VS Code card in Integrations hands over the same file');
{
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(async () => { await _devConnectVSCode(); document.getElementById('vsc-get').click(); }),
  ]);
  ok(dl.suggestedFilename() === 'amv.vsix', 'Download the extension saves amv.vsix', dl.suggestedFilename());
  const closed = await page.waitForFunction(() => !document.getElementById('vsc-bg'), null, { timeout: 5000 }).then(() => true, () => false);
  ok(closed, 'and the dialog closes once it is saved', closed);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();

/* With no server address there is nothing to point the extension at. */
const off = await bootApp({ tab: 'chat' });
const said = await off.page.evaluate(async () => {
  await _apiKeysLoad();
  const toasts = []; const real = window.toast; window.toast = (m) => toasts.push(m);
  const okd = await _vsixDownload(); window.toast = real;
  return { okd, toasts };
});
ok(said.okd === false && said.toasts.some(t => /not connected to its server/.test(t)), 'without a server it refuses, and says why', said);
await off.close();

if (report('the-vs-code-extension-downloads-ready-to-install') > 0) process.exitCode = 1;
done();
