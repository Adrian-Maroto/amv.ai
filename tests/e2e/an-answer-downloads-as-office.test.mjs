/* AN ANSWER DOWNLOADS AS A REAL WORD, EXCEL OR POWERPOINT FILE.

   The catalog used to say "export the .pptx" with nothing behind it. The
   exporter is real now, and this drives it the way a person does - the
   download button under an answer - and then checks the file that arrives:

     - its ZIP checksums, recomputed with Node's own CRC-32, because a wrong
       checksum is exactly what makes Office refuse a file with a repair prompt;
     - its content, read back through AMV's own Office reader.

   (While it was built, the same files were also opened with three
   independent Office libraries; that found a missing default paragraph style
   that this suite now pins.) The exporter is not in the page - it is fetched
   on the first press - so that is checked too, including a failed fetch. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { crc32 } from 'zlib';
import { readFileSync } from 'fs';

const app = await bootApp({ tab: 'chat', blockServiceWorkers: true });
const { page, errors } = app;

const MD = `# Q3 plan for the cafe

Café sales, crème brûlée and 東京 orders are all in here.

Revenue grew **12%** in the north.

## Actions
- Hire two baristas
- Renegotiate the milk contract

## Numbers

| Region | Revenue | Growth |
|---|---|---|
| North | $1,200 | 12% |
| South | 800 | 0% |
| Total | =SUM(B2:B3) | |
`;

await page.evaluate((md) => {
  newChat();
  setMsgs([{ r: 'u', c: 'Plan Q3' }, { r: 'a', c: md }, { r: 'u', c: 'And a haiku?' }, { r: 'a', c: 'Steam on the window,\nmilk foam and a quiet sale,\nthe north keeps growing.' }]);
  renderChatMsgs();
  window.__toasts = [];
  const real = window.toast;
  window.toast = (m, k, ms) => { window.__toasts.push((k || '') + ' | ' + m); return real(m, k, ms); };
}, MD);

/* Every entry's stored CRC against Node's own computation of it. */
function zipCheck(buf){
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { ok: false, why: 'no end record' };
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const names = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return { ok: false, why: 'bad central entry ' + k };
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + ln + le, off + 30 + ln + le + size);
    if (crc32(data) !== crc) return { ok: false, why: 'checksum mismatch in ' + name };
    names.push(name);
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { ok: true, names };
}
const download = async (idx, kind) => {
  await page.click(`[data-action="export"][data-idx="${idx}"]`);
  await page.waitForSelector(`.ctxm [data-exp="${kind}"]`, { timeout: 8000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.ctxm [data-exp="${kind}"]`)]);
  return { name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
};
const readBack = (buf, name) => page.evaluate(async ([b64, n]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const r = await amvReadFile(new File([bytes], n));
  return { kind: r.kind, format: r.format || '', text: r.data || r.reason || '' };
}, [buf.toString('base64'), name]);

section('The exporter is not in the page, and a failed fetch says so');
{
  const before = await page.evaluate(() => typeof window.amvDocx);
  ok(before === 'undefined', 'nothing of it ships with the page', before);
  await page.route('**/office.js', r => r.abort());
  await page.click('[data-action="export"][data-idx="1"]');
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => window.__toasts.slice());
  ok(t.some(x => /^error/.test(x) && /could not be loaded/.test(x)), 'when it cannot be fetched, the person is told', t);
  await page.unroute('**/office.js');
}

section('Word: a real document');
{
  const d = await download(1, 'docx');
  const z = zipCheck(d.buf);
  /* An ASCII heading: the headless browser here reports a non-ASCII download
     name as "download", which a real browser does not. Non-ASCII text INSIDE
     the file is what is checked below. */
  ok(/^Q3 plan for the cafe\.docx$/.test(d.name), 'named after the answer’s heading', d.name);
  ok(z.ok && z.names.includes('word/document.xml') && z.names.includes('word/styles.xml'), 'a sound archive with the parts Word needs', z.why || z.names);
  const styles = (() => { const i = d.buf.indexOf('w:default="1"'); return i > 0; })();
  ok(styles, 'with a default paragraph style, which Word expects');
  const r = await readBack(d.buf, d.name);
  ok(r.format === 'docx' && /^# Q3 plan for the cafe$/m.test(r.text) && /^## Actions$/m.test(r.text), 'headings come back as headings', r.text.slice(0, 120));
  ok(/Café sales, crème brûlée and 東京 orders/.test(r.text), 'and accented and non-Latin text survives intact');
  ok(/^- Hire two baristas$/m.test(r.text), 'list items as list items');
  ok(/\| Region \| Revenue \| Growth \|/.test(r.text) && /\| North \| \$1,200 \| 12% \|/.test(r.text), 'and the table as a table');
}

section('Excel: real cells, numbers as numbers, the formula as a formula');
{
  const d = await download(1, 'xlsx');
  const z = zipCheck(d.buf);
  ok(z.ok && z.names.includes('xl/workbook.xml'), 'a sound workbook archive', z.why || z.names);
  const r = await readBack(d.buf, d.name);
  ok(r.format === 'xlsx' && /^North,1200,0\.12$/m.test(r.text), 'money and percentages are numbers a sheet can add up', r.text.slice(0, 300));
  ok(/B4 = SUM\(B2:B3\)/.test(r.text), 'and the total is a live formula');
}

section('PowerPoint: one slide per section');
{
  const d = await download(1, 'pptx');
  const z = zipCheck(d.buf);
  ok(z.ok && z.names.includes('ppt/slideMasters/slideMaster1.xml') && z.names.includes('ppt/theme/theme1.xml'), 'a sound deck with its master and theme', z.why || z.names.slice(0, 6));
  const r = await readBack(d.buf, d.name);
  ok(/## Slide 1 - Q3 plan for the cafe/.test(r.text) && /## Slide 2 - Actions/.test(r.text) && /## Slide 3 - Numbers/.test(r.text), 'the sections become slides, in order', r.text.slice(0, 200));
  ok(/Hire two baristas/.test(r.text), 'with their points');
}

section('A spreadsheet is only offered where there is a table');
{
  await page.click('[data-action="export"][data-idx="3"]');
  await page.waitForSelector('.ctxm [data-exp="docx"]');
  const items = await page.evaluate(() => [...document.querySelectorAll('.ctxm [data-exp]')].map(b => b.dataset.exp));
  ok(!items.includes('xlsx') && items.includes('docx') && items.includes('pptx'), 'a poem offers Word and PowerPoint, not Excel', items);
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('an-answer-downloads-as-office') > 0) process.exitCode = 1;
done();
