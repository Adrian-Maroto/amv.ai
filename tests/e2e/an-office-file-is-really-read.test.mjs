/* AN OFFICE FILE IS REALLY READ - OR REFUSED BY NAME.

   Help said "AMV reads PDFs, images, code, Excel, CSV, and Word". It did not.
   Anything that was not a picture or a PDF went through readAsText, and a
   .docx/.xlsx/.pptx is a ZIP of XML, so the model was handed the archive's raw
   bytes decoded as text and answered questions about a file it never saw.

   Every case here goes through the real door - the chat's file input - and is
   checked at the two places that matter: what the person sees on the chip or
   in the error, and what the model is actually sent. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { docx, xlsx, pptx, zip } from '../lib/office-fixtures.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'office');
const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  window._callAI = async (msgs) => { window.__sent = msgs[msgs.length - 1]; S.busy = false; };
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  window.__toasts = [];
  const real = window.toast;
  window.toast = (m, k, ms) => { window.__toasts.push((k || '') + ' | ' + m); return real(m, k, ms); };
});

const attach = async (files) => {
  await page.evaluate(() => { S.att = null; window.__toasts = []; window.__sent = null; });
  await page.setInputFiles('#fi', files.map(f => ({ name: f.name, mimeType: f.mime || 'application/octet-stream', buffer: f.buffer })));
  await page.waitForFunction(() => S.att || window.__toasts.length, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(150);
  return page.evaluate(() => ({
    att: S.att ? { kind: S.att.kind, name: S.att.name, mime: S.att.mime || '', format: S.att.format || '', summary: S.att.summary || '', data: S.att.data || '' } : null,
    chip: (document.getElementById('ac') || {}).textContent || '',
    toasts: window.__toasts.slice(),
  }));
};
const sendNow = () => page.evaluate(async () => {
  document.getElementById('mta').value = 'What does it say?';
  await sendMsg();
  const m = window.__sent;
  return m ? (typeof m.c === 'string' ? m.c : JSON.stringify(m.c)) : '';
});

section('A Word document: headings, lists, tables, tracked changes, comments and footnotes');
{
  const r = await attach([{ name: 'plan.docx', buffer: docx() }]);
  const d = r.att && r.att.data;
  ok(r.att && r.att.kind === 'text' && r.att.format === 'docx', 'it is attached as a read Word document', r.att && r.att.format);
  ok(/^# Quarterly plan$/m.test(d), 'the heading is a heading', d && d.slice(0, 80));
  ok(/^- Hire two engineers$/m.test(d), 'a list item is a list item');
  ok(/Budget is eighty thousand\./.test(d) && !/ninety/.test(d), 'tracked changes read as accepted: the inserted word in, the deleted one out');
  ok(/\| Region \| Revenue \|/.test(d) && /\| North \| 1,200 \|/.test(d), 'a table is a table, row by row');
  ok(/Ben: Check these numbers/.test(d), 'a margin comment arrives with who wrote it');
  ok(/Source: finance team/.test(d), 'and a footnote');
  ok(!/PK\u0003\u0004|word\/document\.xml|<w:/.test(d), 'and nothing of the archive or its XML leaks through');
  ok(/Word document/.test(r.chip) && /words/.test(r.chip), 'the chip says what it is and how much was read', r.chip);
  const sent = await sendNow();
  ok(/Word document/.test(sent) && /# Quarterly plan/.test(sent), 'the model is sent the text, and told it was read out of a Word document', sent.slice(0, 160));
}

section('An Excel workbook: every sheet, in place, with dates and formulas');
{
  const r = await attach([{ name: 'sales.xlsx', buffer: xlsx() }]);
  const d = (r.att && r.att.data) || '';
  ok(r.att && r.att.format === 'xlsx', 'it is attached as a read workbook', r.att && r.att.format);
  ok(/Sheet “Sales” - A1:D4/.test(d), 'each sheet is named with the range it covers', d.slice(0, 300));
  ok(/^Region,Revenue,Date$/m.test(d), 'shared strings are resolved');
  ok(/^North,1200,2024-03-15$/m.test(d), 'a date cell reads as a date, not as 45366');
  ok(/^South,800$/m.test(d), 'a string split into rich-text runs is joined');
  ok(/^"Total, all regions",2000,,TRUE$/m.test(d), 'inline strings are quoted when they hold a comma, formulas give their value, booleans read TRUE');
  ok(/B4 = SUM\(B2:B3\)/.test(d), 'and the formula is listed against the cell it lives in');
  ok(/Sheet “Notes” \(hidden\)/.test(d) && /internal note/.test(d), 'a hidden sheet is read and labelled hidden');
  ok(/2 sheets/.test(r.chip), 'the chip counts the sheets', r.chip);
}

section('A PowerPoint deck: slides in the deck’s order, titles, and speaker notes');
{
  const r = await attach([{ name: 'deck.pptx', buffer: pptx() }]);
  const d = (r.att && r.att.data) || '';
  ok(r.att && r.att.format === 'pptx', 'it is attached as a read deck');
  const a = d.indexOf('## Slide 1 - Why AMV'), b = d.indexOf('## Slide 2 - Next steps');
  ok(a >= 0 && b > a, 'the order is the deck’s, not the file names’', d.slice(0, 200));
  ok(/Reads real files\nAnswers from them/.test(d) && /Ship it on Friday/.test(d), 'body text is read, a line per paragraph');
  ok(/Speaker notes: Open with the customer story$/m.test(d), 'speaker notes come along, without the slide-number placeholder');
}

section('Files written by other software read the same way');
{
  const x = await attach([{ name: 'budget.xlsx', buffer: readFileSync(join(FIX, 'budget-exceljs.xlsx')) }]);
  const xd = (x.att && x.att.data) || '';
  ok(/^Rent,1500,2025-01-31$/m.test(xd) && /^Food,420\.5,2025-02-14$/m.test(xd), 'a workbook from another writer: values and both date formats', xd.slice(0, 400));
  ok(/B4 = SUM\(B2:B3\)/.test(xd) && /^Total,1920\.5$/m.test(xd), 'with its formula and cached total');
  ok(/Sheet “Ideas”/.test(xd) && /Cook at home on weekdays/.test(xd), 'and its second sheet');

  const w = await attach([{ name: 'lease.docx', buffer: readFileSync(join(FIX, 'lease-docx.docx')) }]);
  const wd = (w.att && w.att.data) || '';
  ok(/^# Lease summary$/m.test(wd) && /The tenant pays monthly by the 5th\./.test(wd), 'a document from another writer: heading and runs joined', wd.slice(0, 300));
  ok(/^- Pets allowed with a deposit$/m.test(wd) && /\| Term \| 12 months \|/.test(wd), 'with its list and table');

  const p = await attach([{ name: 'launch.pptx', buffer: readFileSync(join(FIX, 'launch-pptxgenjs.pptx')) }]);
  const pd = (p.att && p.att.data) || '';
  ok(/## Slide 1/.test(pd) && /Launch plan/.test(pd) && /Beta in March/.test(pd), 'a deck from another writer: slide one', pd.slice(0, 300));
  ok(/## Slide 2/.test(pd) && /Hiring is slow/.test(pd), 'slide two');
  ok(/Speaker notes: Mention the waitlist numbers/.test(pd), 'and its speaker notes');
}

section('What a file is comes from its bytes, not its name');
{
  const r = await attach([{ name: 'export.bin', buffer: docx() }]);
  ok(r.att && r.att.format === 'docx', 'a Word document with the wrong extension is still read as one', r.att && r.att.format);
  const ts = await attach([{ name: 'app.ts', mime: 'video/mp2t', buffer: Buffer.from('export const answer: number = 42;\n') }]);
  ok(ts.att && ts.att.kind === 'text' && /answer: number/.test(ts.att.data), 'a TypeScript file the system calls "video" is read as the code it is', ts.toasts);
  const latin = await attach([{ name: 'old.csv', buffer: Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x2C, 0x31, 0x0A]) }]);
  ok(latin.att && latin.att.data === 'café,1\n', 'a CSV saved in an older Western encoding reads its accents', latin.att && latin.att.data);
}

section('What cannot be read is refused by name, and nothing is attached');
{
  const cases = [
    { f: { name: 'report.doc', buffer: Buffer.concat([Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]), Buffer.alloc(600)]) }, re: /older Office format.*\.docx/, why: 'an old .doc says to save it as .docx' },
    { f: { name: 'locked.xlsx', buffer: Buffer.concat([Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]), Buffer.alloc(600)]) }, re: /password-protected/, why: 'a password-protected workbook says so' },
    { f: { name: 'memo.m4a', mime: 'audio/mp4', buffer: Buffer.concat([Buffer.from([0,0,0,0x20]), Buffer.from('ftypM4A '), Buffer.alloc(200)]) }, re: /can’t listen to audio/, why: 'an audio recording is not passed off as text' },
    { f: { name: 'song.mp3', buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 7)]) }, re: /can’t listen to audio/, why: 'nor an MP3' },
    { f: { name: 'clip.mp4', mime: 'video/mp4', buffer: Buffer.concat([Buffer.from([0,0,0,0x18]), Buffer.from('ftypisom'), Buffer.alloc(200)]) }, re: /can’t watch video/, why: 'a video is refused' },
    { f: { name: 'broken.docx', buffer: Buffer.from('this was never a document') }, re: /looks damaged/, why: 'a .docx that is not one is called damaged, not read as text' },
    { f: { name: 'scan.pdf', buffer: Buffer.from('hello, I am not a PDF') }, re: /named like a PDF, but it isn’t one/, why: 'a fake PDF is not sent to the engine as a PDF' },
    { f: { name: 'data.bin', buffer: Buffer.from([1,2,3,0,0,0,9,8,7,0,255,254,0,1]) }, re: /AMV can’t read “data\.bin”/, why: 'unknown binary is refused rather than decoded into noise' },
    { f: { name: 'files.zip', buffer: zip({ 'a.txt': 'hello' }) }, re: /archive/, why: 'a plain ZIP says to unzip it first' },
    { f: { name: 'setup.exe', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]) }, re: /is a program/, why: 'a program is a program' },
  ];
  for (const c of cases) {
    const r = await attach([c.f]);
    const said = r.toasts.join(' ');
    ok(!r.att && c.re.test(said) && /^error/.test(r.toasts[0] || ''), c.why, said.slice(0, 160));
  }
}

section('A file built to explode is refused, quickly, without building it');
{
  const t0 = Date.now();
  const r = await attach([{ name: 'bomb.xlsx', buffer: xlsx({ bomb: true }) }]);
  ok(!r.att && /too large/.test(r.toasts.join(' ')), 'a part that inflates past the limit is refused as too large', r.toasts);
  ok(Date.now() - t0 < 10000, 'and the refusal comes in seconds', Date.now() - t0);
}

section('Several files at once: read together, and nothing dropped silently');
{
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const r = await attach([
    { name: 'plan.docx', buffer: docx() },
    { name: 'notes.csv', buffer: Buffer.from('a,b\n1,2\n') },
    { name: 'pic.png', mime: 'image/png', buffer: png },
    { name: 'song.mp3', buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 7)]) },
  ]);
  const d = (r.att && r.att.data) || '';
  ok(/=== plan\.docx \(Word document\) ===/.test(d) && /# Quarterly plan/.test(d), 'the Word document is read inside the combined attachment', d.slice(0, 120));
  ok(/=== notes\.csv ===\na,b/.test(d), 'beside the CSV');
  const said = r.toasts.join(' ');
  ok(/pic\.png/.test(said) && /one picture or PDF/.test(said), 'the picture that could not ride along is named, not folded in as "[binary]"', said.slice(0, 200));
  ok(/song\.mp3/.test(said) && /audio/.test(said), 'and the audio file is refused by name');

  const two = await attach([{ name: 'a.png', mime: 'image/png', buffer: png }, { name: 'b.png', mime: 'image/png', buffer: png }]);
  ok(two.att && two.att.kind === 'img', 'two pictures: one is attached (this used to attach nothing at all)', two.att && two.att.kind);
  ok(/b\.png/.test(two.toasts.join(' ')), 'and the other is named');
}

section('Pictures: what the engine takes goes as itself; anything else is redrawn or refused');
{
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const r = await attach([{ name: 'photo.png', mime: 'image/png', buffer: png }]);
  ok(r.att && r.att.kind === 'img', 'a PNG is attached as a picture');
  const named = await attach([{ name: 'photo.jpg', mime: 'image/jpeg', buffer: Buffer.from('not a picture at all') }]);
  ok(!named.att && /named like a picture/.test(named.toasts.join(' ')), 'a .jpg that is not a picture is refused, not sent to be rejected upstream', named.toasts);
  /* A BMP the browser can decode: redrawn as JPEG, the engine does not take BMP. */
  const bmp = Buffer.from('424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b000000000000000000000000ff00', 'hex');
  const b = await attach([{ name: 'old.bmp', mime: 'image/bmp', buffer: bmp }]);
  ok(b.att && b.att.kind === 'img' && b.att.mime === 'image/jpeg', 'a BMP is redrawn as a JPEG, which the engine accepts', b.att && b.att.mime);
}

section('Nothing on screen promises an Office file AMV cannot make');
{
  /* The other half of the bug: the catalog said "export the .pptx" and
     "builds pivots", and neither existed. Reading is proved above; making
     these files is not built yet, so nothing may claim it. When it is built,
     this list changes in the same commit as the code that makes it true. */
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const copy = ['src/app/13c-app-catalog.js', 'src/app/12-handoff.js'].map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const claims = copy.match(/(export|download)[^'"\n]{0,40}\.(pptx|docx|xlsx)|\.(pptx|docx|xlsx)[^'"\n]{0,40}(export|download)|pivot/gi) || [];
  ok(claims.length === 0, 'no claim to export a .docx, .xlsx or .pptx, or to build pivots', claims);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('an-office-file-is-really-read') > 0) process.exitCode = 1;
done();
