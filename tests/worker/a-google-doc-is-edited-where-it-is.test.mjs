/* A GOOGLE DOC IS EDITED WHERE IT IS - AND WHAT IS REPORTED IS WHAT IT SAYS NOW.

   The Docs and Sheets actions, driven through the Worker's own action table
   with Google stood in for by a document and a spreadsheet held in memory,
   which apply each edit the way Google does - so the read-back is checking a
   real change, not echoing the request:

   - a document is read as its words, tables included;
   - find-and-replace changes every occurrence and reports how many; adding
     to the end adds to the end; the result says it was read back;
   - a file Google will not let AMV open (one nobody chose for it) is said as
     "choose it first", and nothing is claimed;
   - a sheet is read with its tabs, written with formulas kept as formulas,
     and read back;
   - bad ranges, bad values, too many cells and an empty edit are refused
     before anything is sent to Google;
   - an edit whose read-back fails is reported as unconfirmed - never as
     nothing having happened. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'gdocs.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { CONN_ACTIONS };\n');
const W = await import(harness + '?t=' + Date.now());
const A = W.CONN_ACTIONS;

const DOC = 'doc1234567890abc', SHEET = 'sheet1234567890ab', SECRET = 'secret1234567890x';
let docText = 'Quarterly plan\nRevenue target: 100k\nOwner: Sam\n';
let tableCell = 'Budget: 40k\n';
const grid = { 'Plan': [['Item', 'Cost'], ['Rent', '1200']] };
let calls = [], failReadBack = false, edits = 0;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const docBody = () => ({ title: 'Plan', body: { content: [
  { paragraph: { elements: docText.split(/(?<=\n)/).map(t => ({ textRun: { content: t } })) } },
  { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: tableCell } }] } }] }] }] } },
] } });
globalThis.fetch = async (url, init) => {
  const u = decodeURIComponent(String(url));
  const method = (init && init.method) || 'GET';
  calls.push(method + ' ' + u);
  if (u.includes(SECRET)) return reply(404, { error: { message: 'File not found' } });
  if (u.startsWith('https://docs.googleapis.com/v1/documents/' + DOC)) {
    if (method === 'POST') {
      edits++;
      const reqs = JSON.parse(init.body).requests;
      const replies = reqs.map(r => {
        if (r.replaceAllText) {
          const f = r.replaceAllText.containsText.text, to = r.replaceAllText.replaceText;
          const n = docText.split(f).length - 1 + tableCell.split(f).length - 1;
          docText = docText.split(f).join(to); tableCell = tableCell.split(f).join(to);
          return { replaceAllText: { occurrencesChanged: n } };
        }
        if (r.insertText) { docText += r.insertText.text; return {}; }
        return {};
      });
      return reply(200, { replies });
    }
    if (failReadBack && edits > 0) return reply(500, {});
    return reply(200, docBody());
  }
  if (u.startsWith('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET)) {
    if (/\?fields=properties/.test(u)) return reply(200, { properties: { title: 'Budget' }, sheets: [{ properties: { title: 'Plan' } }] });
    const range = u.split('/values/')[1].split('?')[0];
    if (method === 'PUT') {
      const vals = JSON.parse(init.body).values;
      const start = /!?([A-Z]+)(\d+)/.exec(range); const row0 = +start[2] - 1;
      /* As USER_ENTERED does: a number typed as text is stored as the number. */
      vals.forEach((r, i) => { grid.Plan[row0 + i] = r.map(c => /^\s*-?\d+(\.\d+)?\s*$/.test(String(c)) ? String(Number(c)) : String(c)); });
      return reply(200, { updatedRange: range, updatedCells: vals.flat().length });
    }
    /* Only the rows the range names, as Google answers. */
    const m = /!?[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/.exec(range);
    const rows = m ? grid.Plan.slice(+m[1] - 1, m[2] ? +m[2] : undefined) : grid.Plan;
    return reply(200, { range, values: rows });
  }
  throw new Error('the suite reached an address it does not stub: ' + u);
};
const T = 'tok';
const refused = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.message === code; } };

section('A document is read as its words, tables included');
{
  const r = await A['docs.read'].run(T, { fileId: DOC });
  ok(/Revenue target: 100k/.test(r.text) && /Budget: 40k/.test(r.text), 'paragraphs and a table cell are both there', r.text);
  ok(r.link === 'https://docs.google.com/document/d/' + DOC + '/edit', 'with a link to open it');
}

section('Find and replace, and add to the end - read back');
{
  const r = await A['docs.edit'].run(T, { fileId: DOC, replace: [{ find: '100k', with: '150k' }, { find: 'Sam', with: 'Ana' }], append: 'Reviewed by AMV.' });
  ok(r.replaced[0].count === 1 && r.replaced[1].count === 1, 'each find reports how many it changed', r.replaced);
  ok(/150k/.test(docText) && /Ana/.test(docText) && /Reviewed by AMV\.$/.test(docText), 'and the document really says it now', docText);
  ok(r.verified === true, 'the result says it was read back and matches');
  const z = await A['docs.edit'].run(T, { fileId: DOC, replace: [{ find: 'nowhere in here', with: 'x' }] });
  ok(z.replaced[0].count === 0, 'a find that matches nothing says zero, rather than claiming a change', z.replaced);
}

section('A file nobody chose for AMV: "choose it first", and nothing claimed');
{
  ok(await refused(() => A['docs.read'].run(T, { fileId: SECRET }), 'docs_not_chosen'), 'a document');
  ok(await refused(() => A['sheets.read'].run(T, { fileId: SECRET }), 'sheets_not_chosen'), 'and a sheet');
}

section('A sheet is read with its tabs, written with formulas kept, and read back');
{
  const r = await A['sheets.read'].run(T, { fileId: SHEET });
  ok(r.tabs.join() === 'Plan' && r.rows[1][1] === '1200', 'the first tab by default', r);
  const w = await A['sheets.write'].run(T, { fileId: SHEET, range: 'Plan!A3:B4', values: [['Food', 300], ['Total', '=SUM(B2:B3)']] });
  ok(w.updatedCells === 4 && w.verified === true, 'four cells written and read back', w);
  ok(grid.Plan[3][1] === '=SUM(B2:B3)', 'a formula is stored as a formula', grid.Plan[3]);
  const odd = await A['sheets.write'].run(T, { fileId: SHEET, range: 'Plan!C1', values: [[' 42']] });
  ok(odd.verified === false, 'when the sheet holds something other than what was sent, it says so rather than claiming a match', odd);
}

section('Refused before anything reaches Google');
{
  calls = [];
  ok(await refused(() => A['sheets.write'].run(T, { fileId: SHEET, range: 'A1; DROP', values: [['x']] }), 'bad_range'), 'a range that is not a range');
  ok(await refused(() => A['sheets.write'].run(T, { fileId: SHEET, range: 'A1', values: 'x' }), 'bad_values'), 'values that are not rows');
  ok(await refused(() => A['sheets.write'].run(T, { fileId: SHEET, range: 'A1', values: Array.from({ length: 101 }, () => Array(100).fill(1)) }), 'too_many_cells'), 'more than 10,000 cells');
  ok(await refused(() => A['docs.edit'].run(T, { fileId: DOC }), 'bad_edit'), 'an edit with nothing in it');
  ok(await refused(() => A['docs.read'].run(T, { fileId: '../../etc' }), 'bad_file'), 'a file id that is not one');
  ok(calls.length === 0, 'and Google was never called for any of them', calls);
}

section('An edit whose read-back fails is unconfirmed, not "nothing happened"');
{
  failReadBack = true;
  const r = await A['docs.edit'].run(T, { fileId: DOC, replace: [{ find: 'Ana', with: 'Lee' }] });
  ok(r.replaced[0].count === 1 && r.verified === null, 'the change is reported, and marked as not read back', r);
  ok(/Lee/.test(docText), 'because it did happen');
  failReadBack = false;
}

section('Both are writes, on the narrow permission');
{
  ok(A['docs.edit'].writes === true && A['sheets.write'].writes === true, 'edits are writes, so they are rate-limited as writes');
  ok(['docs.read', 'docs.edit', 'sheets.read', 'sheets.write'].every(n => A[n].need === 'drive.write'),
     'every one needs drive.file - only files chosen for AMV or made by it');
}

if (report('a-google-doc-is-edited-where-it-is') > 0) process.exitCode = 1;
done();
