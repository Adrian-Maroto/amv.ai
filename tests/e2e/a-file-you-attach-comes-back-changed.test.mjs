/* A FILE YOU ATTACH COMES BACK CHANGED - THE SAME FILE, WITH ONLY THAT CHANGE.

   Somebody attaches their own Word document, workbook or deck and asks for a
   change. What they get back must be THEIR file: the styles, numbering,
   comments, footnotes, pictures and sheets they did not ask about, untouched
   to the byte - not a new document with the same words. Driven through the
   real composer, the real Worker (which must forward the tool at all) and
   the real download, with the model's choices scripted; the files are ones
   written by independent Office software, and where LibreOffice is installed
   it opens every result, as a second reader that is not AMV's.

   - the tool is offered only while an Office file is attached, naming it;
   - a change touches only what differs, so a bold word stays bold;
   - a new paragraph takes the style of the one it follows;
   - every other part of the file is byte-identical to the original;
   - a cell keeps its format, a formula is a formula, and Excel is told to
     work them out again;
   - what cannot be done is refused by name, and an edit that might land in
     the wrong place changes nothing at all;
   - a second change builds on the first. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { zip } from '../lib/office-fixtures.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { inflateRawSync } from 'zlib';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'office');
const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
function toolUse(name, input) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2, 9), name } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input || {}) } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
    + ev('message_stop', { type: 'message_stop' });
}
function text(t) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })
    + ev('message_stop', { type: 'message_stop' });
}

/* Every part of a ZIP, uncompressed, by name - read here with Node's own
   inflate, not with anything AMV wrote. */
function unzip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = buf.readUInt16LE(eocd + 10); k > 0; k--) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nl), off = buf.readUInt32LE(p + 42);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
const sameExcept = (a, b, changed) => [...a.keys()].filter(k => !changed.includes(k) && !(b.has(k) && a.get(k).equals(b.get(k))));

/* LibreOffice, when it is here, as a reader that is not AMV's. */
const LO = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore', timeout: 60000 }); return true; } catch (e) { return false; } })();
const loDir = mkdtempSync(join(tmpdir(), 'amv-lo-'));
function lo(buf, name, to) {
  writeFileSync(join(loDir, name), buf);
  execFileSync('soffice', ['-env:UserInstallation=file://' + join(loDir, 'profile'), '--headless', '--convert-to', to, '--outdir', loDir, join(loDir, name)],
               { stdio: 'ignore', timeout: 120000 });
  const outName = name.replace(/\.[^.]+$/, '.' + to.split(':')[0]);
  return existsSync(join(loDir, outName)) ? readFileSync(join(loDir, outName), 'utf8') : null;
}

let nextTurns = [];
const modelSaw = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  let body = {}; try { body = JSON.parse(String(opts.body || '{}')); } catch (e) {}
  modelSaw.push(body);
  const chat = Array.isArray(body.tools) && body.tools.length > 0;
  return new Response(chat && nextTurns.length ? nextTurns.shift() : text('Done.'),
                      { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9187', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9187 });
const { page } = L;

async function say(t) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(attempt ? 9000 : 3000);
    /* The test browser can lose its handle on the page's scripts in the middle
       of this step with the page itself untouched (measured: the document's
       start time is the same before and after), here and in CI. When it does,
       whether the message went out is read from the model's side - what the
       stand-in model received - and it is sent again only if it did not, so
       nothing is sent twice and nothing is assumed. */
    const asked = modelSaw.length;
    const send = () => page.evaluate(async (t) => {
      setTab('chat'); await new Promise(x => setTimeout(x, 200));
      const box = document.getElementById('mta'); box.value = t;
      box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg();
    }, t);
    try { await send(); }
    catch (e) {
      if (!/context was destroyed/.test(String(e && e.message))) throw e;
      await page.waitForTimeout(2000);
      if (modelSaw.length === asked) await send();
    }
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === true, null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(400); await L.settle();
    const limited = await page.evaluate(() => { const m = getMsgs(); const l = m[m.length - 1];
      return !!(l && l.r === 'a' && /too many requests/i.test(String(l.c || ''))); });
    if (!limited) return;
  }
}
const lastTools = () => ([...modelSaw].reverse().find(b => Array.isArray(b.tools) && b.tools.length) || { tools: [] }).tools;
/* What the tool told the model, read from the request that carried it back. */
const lastToolResult = () => {
  for (const b of [...modelSaw].reverse()) for (const m of [...(b.messages || [])].reverse()) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    const r = m.content.find(c => c && c.type === 'tool_result');
    if (r) return typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
  }
  return '';
};
const attach = async (name) => {
  await page.evaluate(() => { S.att = null; });
  await page.setInputFiles('#fi', [{ name, mimeType: 'application/octet-stream', buffer: readFileSync(join(FIX, name)) }]);
  await page.waitForFunction(() => S.att && S.att.format, null, { timeout: 15000 });
};
/* The newest card's Download. The first goes through the browser's own
   download, to the file on disk. The rest capture the bytes handed to the
   save itself (_saveBlob): in the test browser a finished download can reset
   the page's script context a moment later, with the page itself unchanged,
   and a send caught in that moment fails for a reason that is not AMV's. */
let realDownloads = 0;
async function download() {
  /* A plan prompt can open over the chat after a few messages; it is not
     what is being tested, so it is closed the way a person would. */
  await page.evaluate(() => { try { closeOvr(); } catch (e) {} });
  const btn = page.locator('[data-dact="amvOfficeSave"]').last();
  if (!realDownloads++) {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 40000 }), btn.click({ timeout: 20000 })]);
    const got = { name: d.suggestedFilename(), buf: readFileSync(await d.path()) };
    for (let i = 0; i < 20; i++) { await page.waitForTimeout(250); try { await page.evaluate(() => 1); break; } catch (e) {} }
    await page.waitForTimeout(1500);
    return got;
  }
  await page.evaluate(() => { window.__saved = null; window._saveBlob = async (blob, name) => { window.__saved = { name, b64: await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); }) }; }; });
  await btn.click({ timeout: 20000 });
  await page.waitForFunction(() => window.__saved, null, { timeout: 15000 });
  const s = await page.evaluate(() => window.__saved);
  return { name: s.name, buf: Buffer.from(s.b64, 'base64') };
}
const cards = () => page.locator('[data-dact="amvOfficeSave"]').count();

section('Signed in');
{
  await page.evaluate(async () => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Files'); type('#a-email', 'files@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  });
  await env.AMV_KV.put('ent:files@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  ok(true, 'an account on a paid plan');
}

section('The tool is there only while an Office file is attached, and names it');
{
  nextTurns = [text('Hi.')];
  await say('hello');
  ok(lastTools().length > 0 && !lastTools().some(t => t.name === 'office_edit'), 'no file: no office_edit', lastTools().map(t => t.name));
  await attach('lease-docx.docx');
  nextTurns = [text('I see the lease.')];
  await say('what is in it?');
  const t = lastTools().find(x => x.name === 'office_edit');
  ok(!!t, 'with a Word file attached, the model is offered office_edit - so the server forwarded it', lastTools().map(x => x.name));
  ok(t && JSON.stringify(t.input_schema.properties.file.enum) === '["lease-docx.docx"]', 'and it can name only the file that is there', t && t.input_schema.properties.file);
}

const lease = readFileSync(join(FIX, 'lease-docx.docx'));
let edited1;
section('A Word document comes back as itself, with only the change in it');
{
  nextTurns = [toolUse('office_edit', { file: 'lease-docx.docx', changes: [
    { find: 'monthly by the 5th', with: 'monthly by the 1st' },
    { after: 'The tenant pays', insert: 'Late payments add a 5% fee.' },
    { find: 'a clause that is not there', with: 'anything' },
  ] }), text('Done - download it below.')];
  await say('pay by the 1st, add a late fee line, and fix the missing clause');
  const said = lastToolResult();
  ok(/checked it by opening the new file again/.test(said) && /"monthly by the 5th" -> "monthly by the 1st"/.test(said),
     'the model is told what changed, and that it was read back', said.slice(0, 300));
  ok(/NOT changed[\s\S]*"a clause that is not there" is not in the document/.test(said), 'and what was refused, and why', said);
  ok(await cards() === 1, 'a download is offered', await cards());
  const card = await page.locator('.oe-card').last().innerText();
  ok(/lease-docx \(edited\)\.docx/i.test(card) && /Not changed:/i.test(card), 'the card names the file and says what was not changed', card);
  const got = await download();
  edited1 = got.buf;
  ok(got.name === 'lease-docx (edited).docx', 'it downloads under the file’s own name, marked edited', got.name);
  const a = unzip(lease), b = unzip(got.buf);
  const doc = b.get('word/document.xml').toString('utf8');
  ok(sameExcept(a, b, ['word/document.xml']).length === 0 && a.size === b.size,
     'every other part - styles, numbering, comments, footnotes, settings - is byte-identical', sameExcept(a, b, ['word/document.xml']));
  ok(/<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">monthly<\/w:t>/.test(doc) && /> by the 1st\.</.test(doc) && !/5th/.test(doc),
     'only the 5 changed: "monthly" is still bold on its own, and nothing new became bold', doc.match(/The tenant pays[\s\S]{0,400}/)[0]);
  const paras = doc.match(/<w:p\b[\s\S]*?<\/w:p>/g);
  const i = paras.findIndex(p => /The tenant pays/.test(p));
  ok(/Late payments add a 5% fee\./.test(paras[i + 1] || '') && /Pets allowed/.test(paras[i + 2] || ''),
     'the new paragraph is right after the one it was asked to follow', (paras[i + 1] || '').slice(0, 200));
  ok(!/<w:b\/>[^]*Late payments/.test(paras[i + 1]), 'and in that paragraph’s plain style, not the bold word’s', paras[i + 1]);
  if (LO) {
    const txt = lo(got.buf, 'lease.docx', 'txt:Text') || '';
    ok(/The tenant pays monthly by the 1st\.\s*\n\s*Late payments add a 5% fee\.\s*\n/.test(txt) && /Lease summary/.test(txt),
       'LibreOffice opens it and reads the changed text, in order', txt.slice(0, 300));
  } else console.log('  (LibreOffice is not installed here, so the second reader was not run)');
}

section('An edit that could land in the wrong place changes nothing');
{
  const before = await cards();
  nextTurns = [toolUse('office_edit', { file: 'lease-docx.docx', changes: [{ find: 'e', with: 'E' }] }), text('Could not.')];
  await say('capitalise every e');
  const said = lastToolResult();
  ok(/NOTHING was changed/.test(said) && /appears \d+ times/.test(said), 'the model is told nothing changed, and why', said.slice(0, 300));
  ok(await cards() === before, 'and no file is offered', await cards());
  ok(/was not changed/i.test(await page.locator('.chat-run.bad').last().innerText()), 'the person sees that it was not changed');
}

section('A second change builds on the first');
{
  nextTurns = [toolUse('office_edit', { file: 'lease-docx.docx', changes: [{ find: '12 months', with: '24 months' }] }), text('Done.')];
  await say('make the term two years');
  const got = await download();
  ok(got.name === 'lease-docx (edited 2).docx', 'the second version is named as the second', got.name);
  const doc = unzip(got.buf).get('word/document.xml').toString('utf8');
  ok(/24 months/.test(doc) && /by the 1st/.test(doc) && /Late payments/.test(doc), 'and has both changes in it', doc.length);
  const prev = unzip(edited1);
  ok(sameExcept(prev, unzip(got.buf), ['word/document.xml']).length === 0, 'everything else still byte-identical', true);
}

section('A workbook: numbers stay numbers, a formula is a formula, Excel works it out again');
{
  await attach('budget-exceljs.xlsx');
  nextTurns = [toolUse('office_edit', { file: 'budget-exceljs.xlsx', cells: [
    { cell: 'B2', value: 1600 },
    { cell: 'A5', value: 'Tax' },
    { cell: 'B5', value: '=B4*0.1' },
    { sheet: 'Ideas', cell: 'A2', value: '007' },
    { cell: 'ZZZZ9', value: 1 },
    { sheet: 'Nope', cell: 'A1', value: 1 },
  ] }), text('Updated.')];
  await say('rent is 1600, add a tax line');
  const said = lastToolResult();
  ok(/B2 = 1600/.test(said) && /B5 = =B4\*0\.1/.test(said), 'the model is told each cell that changed', said.slice(0, 400));
  ok(/worked out again when it is opened/.test(said), 'and that formulas are worked out when the file is opened', said);
  ok(/"ZZZZ9" is not a cell address/.test(said) && /no sheet called "Nope"[\s\S]*Budget, Ideas/.test(said), 'and the two it could not, with the sheets there are', said);
  const got = await download();
  const a = unzip(readFileSync(join(FIX, 'budget-exceljs.xlsx'))), b = unzip(got.buf);
  const s1 = b.get('xl/worksheets/sheet1.xml').toString('utf8'), s2 = b.get('xl/worksheets/sheet2.xml').toString('utf8');
  ok(/<c r="B2"><v>1600<\/v><\/c>/.test(s1), 'B2 is the number 1600', s1.match(/<c r="B2".*?<\/c>/)[0]);
  ok(/<c r="B4"><f>SUM\(B2:B3\)<\/f><\/c>/.test(s1) && !/1920\.5/.test(s1),
     'the old total is not left in the file to be believed: its formula stays, its stale result goes', s1.match(/<c r="B4".*?<\/c>/));
  ok(/<c r="B4"><f>SUM\(B2:B3\)<\/f>/.test(s1) && /<c r="B5"><f>B4\*0\.1<\/f><\/c>/.test(s1), 'the old formula is kept and the new one is a formula', s1.match(/<row r="5".*?<\/row>/));
  ok(/<c r="A5" t="inlineStr"><is><t xml:space="preserve">Tax<\/t><\/is><\/c>/.test(s1), 'a word is text', s1.match(/<c r="A5".*?<\/c>/));
  ok(/<c r="A2" t="inlineStr"><is><t xml:space="preserve">007<\/t>/.test(s2), 'a code with leading zeros stays as written, not the number 7', s2.match(/<c r="A2".*?<\/c>/));
  ok(/fullCalcOnLoad="1"/.test(b.get('xl/workbook.xml').toString('utf8')), 'and Excel is told to work the formulas out when it opens it');
  ok(sameExcept(a, b, ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/workbook.xml']).length === 0,
     'styles, shared text and the theme are byte-identical', sameExcept(a, b, ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/workbook.xml']));
  if (LO) {
    const csv = lo(got.buf, 'budget.xlsx', 'csv') || '';
    ok(/^.*,1600,/m.test(csv) && /,2020\.5\b/.test(csv) && /^Tax,202\.05\b/m.test(csv),
       'LibreOffice opens it and the totals are worked out from the new numbers', csv);
  }
}

section('A workbook change that would make Excel repair the file is refused by name');
{
  /* Built here so each hazard is in it on purpose: a merge, a formula other
     cells share, a table whose header names its columns, and the list Excel
     keeps of which cells hold formulas. */
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const is = (r, t) => '<c r="' + r + '" t="inlineStr"><is><t>' + t + '</t></is></c>';
  const edge = zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="' + CT + 'sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + CT + 'worksheet+xml"/>'
      + '<Override PartName="/xl/tables/table1.xml" ContentType="' + CT + 'table+xml"/><Override PartName="/xl/calcChain.xml" ContentType="' + CT + 'calcChain+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="' + S + '" xmlns:r="' + R + '"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + R + '/calcChain" Target="calcChain.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + S + '" xmlns:r="' + R + '"><sheetData>'
      + '<row r="1">' + is('A1', 'Title') + '<c r="C1"><f t="shared" ref="C1:C2" si="0">D1*2</f><v>2</v></c><c r="D1"><v>1</v></c>' + is('E1', 'Name') + is('F1', 'Qty') + '</row>'
      + '<row r="2"><c r="C2"><f t="shared" si="0"/><v>4</v></c><c r="D2"><v>2</v></c>' + is('E2', 'Pens') + '<c r="F2"><v>3</v></c></row>'
      + '<row r="3">' + is('E3', 'Ink') + '<c r="F3"><v>5</v></c></row>'
      + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/table" Target="../tables/table1.xml"/></Relationships>',
    'xl/tables/table1.xml': '<?xml version="1.0" encoding="UTF-8"?><table xmlns="' + S + '" id="1" name="Stock" displayName="Stock" ref="E1:F3"><tableColumns count="2"><tableColumn id="1" name="Name"/><tableColumn id="2" name="Qty"/></tableColumns></table>',
    'xl/calcChain.xml': '<?xml version="1.0" encoding="UTF-8"?><calcChain xmlns="' + S + '"><c r="C1" i="1"/><c r="C2"/></calcChain>',
  });
  await page.evaluate(() => { S.att = null; });
  await page.setInputFiles('#fi', [{ name: 'stock.xlsx', mimeType: 'application/octet-stream', buffer: edge }]);
  await page.waitForFunction(() => S.att && S.att.format === 'xlsx', null, { timeout: 15000 });
  nextTurns = [toolUse('office_edit', { file: 'stock.xlsx', cells: [
    { cell: 'B1', value: 'x' }, { cell: 'C1', value: 9 }, { cell: 'E1', value: 'Item' }, { cell: 'F2', value: 30 }, { cell: 'C2', value: 7 },
  ] }), text('Done.')];
  await say('update the stock sheet');
  const said = lastToolResult();
  ok(/B1 is hidden under merged cells; write to A1/.test(said), 'a cell under a merge is refused, and the cell to use instead is named', said);
  ok(/C1 starts a formula other cells share/.test(said), 'the cell a shared formula starts from is refused', said);
  ok(/E1 is the name of a table column/.test(said), 'a table’s column name is refused', said);
  ok(/F2 = 30/.test(said) && /C2 = 7/.test(said), 'and the others are made - including one that only followed the shared formula', said);
  const b = unzip((await download()).buf);
  ok(!b.has('xl/calcChain.xml') && !/calcChain/.test(b.get('xl/_rels/workbook.xml.rels').toString()) && !/calcChain/.test(b.get('[Content_Types].xml').toString()),
     'the list of formula cells is dropped everywhere it was named, so Excel rebuilds it rather than offering a repair', [...b.keys()]);
  const s1 = b.get('xl/worksheets/sheet1.xml').toString();
  ok(/<c r="C1"><f t="shared" ref="C1:C2" si="0">D1\*2<\/f><\/c>/.test(s1) && /<c r="C2"><v>7<\/v><\/c>/.test(s1) && /<c r="F2"><v>30<\/v><\/c>/.test(s1),
     'the shared formula is intact, and the cells that changed hold what was asked', s1);
  if (LO) {
    const csv = lo(Buffer.from((await download()).buf), 'stock.xlsx', 'csv') || '';
    ok(/^Title,,2,1,Name,Qty/m.test(csv) && /^,,7,2,Pens,30/m.test(csv), 'LibreOffice opens it and works the formula out again', csv);
  }
}

section('A deck: the slide text changes, the rest of the deck does not');
{
  await attach('launch-pptxgenjs.pptx');
  nextTurns = [toolUse('office_edit', { file: 'launch-pptxgenjs.pptx', changes: [
    { find: 'Beta in March', with: 'Beta in April' }, { after: 'Hiring is slow', insert: 'Budget is tight' }] }), text('Done.')];
  await say('beta slipped to April; add a budget risk');
  const got = await download();
  const a = unzip(readFileSync(join(FIX, 'launch-pptxgenjs.pptx'))), b = unzip(got.buf);
  ok(/Beta in April/.test(b.get('ppt/slides/slide1.xml').toString('utf8')), 'slide 1 says April');
  const s2 = b.get('ppt/slides/slide2.xml').toString('utf8');
  ok(/Hiring is slow[\s\S]*Budget is tight/.test(s2), 'slide 2 has the new point after the one it follows', s2.length);
  ok(sameExcept(a, b, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']).length === 0 && a.size === b.size,
     'the layouts, theme, notes and media are byte-identical', sameExcept(a, b, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']));
}

section('A file that does not read back as intended is never offered');
{
  /* The writer is made to lose the change on its way into the file - the
     kind of fault the read-back exists for - and the result must say so. */
  const r = await page.evaluate(async () => {
    const real = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function(n){ return real.call(this, n).replace('Shipping slipped', 'Shipping is fine'); };
    try { return await _amvRunTool('office_edit', { file: 'launch-pptxgenjs.pptx', changes: [{ after: 'Budget is tight', insert: 'Shipping slipped' }] }, () => {}); }
    finally { XMLSerializer.prototype.serializeToString = real; }
  });
  ok(/NOTHING was changed/.test(r.text) && /was checked and the new paragraph "Shipping slipped" is not in it/.test(r.text) && !/amvOfficeSave/.test(r.render || ''),
     'the change was missing from the file it wrote, so no file is offered and the model is told', r.text);
}

section('A card from an earlier visit says so, instead of downloading nothing');
{
  const r = await page.evaluate(() => amvOfficeSave('of-from-another-day'));
  ok(r === false, 'nothing is saved', r);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
try { rmSync(loDir, { recursive: true, force: true }); } catch (e) {}
await L.close();
if (report('a-file-you-attach-comes-back-changed') > 0) process.exitCode = 1;
done();
