/* A SPREADSHEET DOES THE MATHS ITSELF.

   The editor's toolbar had "Sort by first column", "Add totals row" and "Find
   duplicates" - each one sent the whole table to the model and pasted back
   whatever CSV came out, with no undo. Arithmetic and ordering by guess, on
   somebody's own numbers. And none of it ran: the toolbar checked for a key
   setting nothing has written since the engine moved to the server, so every
   press said "AMV isn't connected" - the background Gmail and calendar checks
   had the same dead check.

   Now sorting, filtering, totals, duplicates, summaries by a column and
   formulas are computed, and the model answers questions - a change it
   proposes is applied only when the person presses Apply. Driven through the
   real controls: keys typed into cells, the header's sort button, the
   download buttons; the files that arrive are read back. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ana', email: 'ana@example.com', ini: 'A' }, blockServiceWorkers: true });
const { page, errors } = app;
/* Cookie choice made, as a person would before working; the banner otherwise
   sits over the bottom of the editor. */
await page.evaluate(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} document.getElementById('cookie-consent-banner')?.remove(); });

/* A Spanish export: semicolons, decimal commas, a quoted field with a
   semicolon and a line break inside it, and a running total. */
const CSV = 'Región;Unidades;Precio;Importe\r\nNorte;120;1.200,50;=B2*C2\r\nSur;95;800;=B3*C3\r\n"Este; ""grande""\nnave 2";140;12,5;=B4*C4\r\nSur;95;800;=B5*C5\r\n';

const cell = (c, r) => page.evaluate(([c, r]) => { const el = document.querySelector(`#sh-scroll .sh-cell[data-c="${c}"][data-r="${r}"]`); return el ? el.textContent : null; }, [c, r]);
const col = (c) => page.evaluate((c) => [...document.querySelectorAll(`#sh-scroll tbody .sh-cell[data-c="${c}"]`)].map(e => e.textContent), c);
const typeInto = async (c, r, text) => {
  await page.click(`#sh-scroll .sh-cell[data-c="${c}"][data-r="${r}"]`);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};
const download = async (sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  return { name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
};

section('The editor is not in the page; it arrives when a table is opened');
{
  ok(await page.evaluate(() => typeof window.amvSheet) === 'undefined', 'nothing of it ships with the page');
  await page.evaluate((csv) => { S.att = { kind: 'text', name: 'ventas.csv', size: csv.length, data: csv }; showAttChip(); document.querySelector('#ac .att-open').click(); }, CSV);
  await page.waitForSelector('#sh-scroll .sh-cell', { timeout: 8000 });
  ok(await page.evaluate(() => typeof window.amvSheet) === 'object', 'and it is fetched on the first open');
}

section('A European CSV is read as one: semicolons, decimal commas, quotes, a line break inside a cell');
{
  const heads = await page.evaluate(() => [...document.querySelectorAll('#sh-scroll thead .sh-cell')].map(e => e.textContent));
  ok(heads.join('|') === 'Región|Unidades|Precio|Importe', 'four columns, named as in the file', heads);
  ok(await cell(0, 3) === 'Este; "grande"\nnave 2', 'the quoted cell keeps its semicolon, its quotes and its line break', await cell(0, 3));
  const d2 = await page.evaluate(() => amvSheet._test.num('1.200,50'));
  ok(d2 === 1200.5, '1.200,50 is twelve hundred and a half here', d2);
  const v = await page.evaluate(() => { const el = document.querySelector('#sh-scroll .sh-cell[data-c="3"][data-r="1"]'); return el.textContent; });
  ok(/144[.,\s]?060/.test(v), 'and the formula =B2*C2 multiplies the real numbers (120 × 1.200,50)', v);
}

section('Typing a formula works it out; changing what it uses changes the answer');
{
  await page.click('#sh-addrow');
  await typeInto(0, 5, 'Total');
  await typeInto(1, 5, '=SUM(B2:B5)');
  ok(await cell(1, 5) === '450', '=SUM(B2:B5) is 450', await cell(1, 5));
  await page.click('#sh-scroll .sh-cell[data-c="1"][data-r="5"]');
  const bar = await page.evaluate(() => document.getElementById('sh-fbar').textContent);
  ok(/B6\s*=SUM\(B2:B5\)/.test(bar), 'and the formula is shown, with its cell, when the cell is selected', bar);
  await page.keyboard.press('Escape');
  await typeInto(1, 1, '220');
  ok(await cell(1, 5) === '550', 'changing B2 to 220 makes it 550', await cell(1, 5));
  /* The edit ends with a click on another cell; that cell must keep the click. */
  await page.click('#sh-scroll .sh-cell[data-c="1"][data-r="2"]');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('105');
  await page.click('#sh-scroll .sh-cell[data-c="0"][data-r="1"]');
  const active = await page.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.c + ':' + document.activeElement.dataset.r : '');
  ok(active === '0:1', 'clicking another cell after an edit lands in that cell', active);
  ok(await cell(1, 5) === '560', 'and the edit counted (95 → 105)', await cell(1, 5));
  await page.keyboard.press('Escape');
}

section('Sorting is by value, the total stays at the bottom, and a row’s own formula moves with it');
{
  await page.click('#sh-scroll .sh-sort[data-sort="1"]');
  const units = await col(1);
  ok(units.join(',') === '95,105,140,220,=SUM(B2:B5)'.replace('=SUM(B2:B5)', '560'), 'units ascending as numbers, total last', units);
  await page.click('#sh-scroll .sh-sort[data-sort="1"]');
  const down = await col(1);
  ok(down.join(',') === '220,140,105,95,560', 'and descending on the second press', down);
  const own = await page.evaluate(() => { const g = []; document.querySelectorAll('#sh-scroll tbody tr').forEach(tr => g.push(tr.querySelector('.sh-cell[data-c="0"]').textContent)); return g; });
  ok(own[0] === 'Norte', 'Norte (220 units) is first', own);
  const importe = await page.evaluate(() => amvSheet._test.show(new amvSheet._test.Book([['x']]).val(0, 0)));
  const raw = await page.evaluate(() => document.querySelector('#sh-scroll .sh-cell[data-c="3"][data-r="1"]').textContent);
  ok(/264[.,\s]?110/.test(raw), 'its =B*C formula followed it and still multiplies its own row (220 × 1.200,50)', raw);
  const sorted = await page.evaluate(() => document.querySelector('#sh-scroll thead th[aria-sort]') && document.querySelector('#sh-scroll thead th[aria-sort]').getAttribute('aria-sort'));
  ok(sorted === 'descending', 'and the column says how it is sorted, for a screen reader too', sorted);
  void importe;
}

section('Undo puts it back');
{
  await page.click('#sh-undo'); await page.click('#sh-undo');
  ok((await col(1)).join(',') === '220,105,140,95,560', 'two undos restore the order before sorting', await col(1));
}

section('Filter, totals, duplicates');
{
  await page.fill('#sh-filter', 'sur');
  ok((await col(0)).join(',') === 'Sur,Sur', 'filtering shows the matching rows', await col(0));
  ok(/Showing 2 of 5/.test(await page.evaluate(() => document.getElementById('sh-stat').textContent)), 'and says how many are shown');
  await page.fill('#sh-filter', '');
  await typeInto(1, 2, '95');
  await page.click('#sh-totals');
  const foot = await page.evaluate(() => [...document.querySelectorAll('#sh-scroll tfoot td')].map(td => td.textContent));
  /* The sheet already has a Total row (=SUM(B2:B5)); adding it in again would
     count every unit twice. */
  ok(foot[0] === 'Total' && foot[1] === '550', 'the totals row adds the data rows, not the sheet’s own total again', foot);
  await page.click('#sh-scroll .sh-cell[data-c="1"][data-r="1"]');
  const stat = await page.evaluate(() => document.getElementById('sh-stat').textContent);
  ok(/Sum 550 /.test(stat) && /Count 4$/.test(stat), 'and the column summary under the table agrees', stat);
  await page.keyboard.press('Escape');
  await page.click('#sh-totals');
  await page.click('#sh-dups');
  const dupRows = await page.evaluate(() => document.querySelectorAll('#sh-scroll tr.sh-dup').length);
  ok(dupRows === 1, 'the repeated Sur row is found', dupRows);
  await page.click('#sh-note-act');
  ok((await col(0)).length === 4, 'Remove them deletes it', await col(0));
  await page.click('#sh-undo');
  ok((await col(0)).length === 5, 'and Undo brings it back', await col(0));
}

section('Summarise by a column - a pivot table');
{
  await page.click('#sh-pivot');
  await page.selectOption('#pv-g', '0');
  await page.selectOption('#pv-f', 'sum');
  await page.selectOption('#pv-v', '1');
  const pv = await page.evaluate(() => [...document.querySelectorAll('.sh-pv-tbl tbody tr')].map(tr => [...tr.children].map(td => td.textContent).join('=')));
  ok(pv.includes('Sur=190') && pv.includes('Norte=220'), 'units summed per region', pv);
  ok(!pv.some(r => /^Total=/.test(r)), 'and the sheet’s Total row is not a region', pv);
  await page.selectOption('#pv-f', 'count');
  const n = await page.evaluate(() => [...document.querySelectorAll('.sh-pv-tbl tbody tr')].map(tr => [...tr.children].map(td => td.textContent).join('=')));
  ok(n.includes('Sur=2'), 'and counted', n);
  await page.click('#pv-use');
  ok((await page.evaluate(() => [...document.querySelectorAll('#sh-scroll thead .sh-cell')].map(e => e.textContent))).length === 2, 'Open as a sheet makes the summary the table');
  await page.click('#sh-undo');
  ok((await col(0)).length === 5, 'and Undo returns to the data');
  await page.click('#sh-pivot');
}

section('CSV download: the values, with nothing that runs when opened');
{
  await typeInto(0, 4, '=HYPERLINK("http://evil.example","x")');
  await typeInto(2, 2, '@SUM(1)');
  const d = await download('[data-dact="_sheetDownloadCSV"]');
  const text = d.buf.toString('utf8');
  ok(d.name === 'ventas.csv', 'named after the file', d.name);
  ok(/\r\nNorte;220;1\.200,50;264110\r\n/.test(text) && /^Total;550;;$/.test(text.split('\r\n').slice(-1)[0]), 'formulas written as their results, in the file’s own format (semicolons, decimal commas)', text.slice(0, 200));
  ok(/'@SUM\(1\)/.test(text) && !/;=HYPERLINK/.test(text), 'text that looks like a formula is written as text', text);
}

section('Excel download: real formulas, and only the ones AMV knows');
{
  await typeInto(0, 4, '=WEBSERVICE("http://evil.example")');
  const d = await download('#sh-xlsx');
  const xml = d.buf.toString('latin1');
  ok(/<f>SUM\(B2:B5\)<\/f>/.test(xml) && /<f>B2\*C2<\/f>/.test(xml), 'SUM and the row formulas are live formulas', d.name);
  ok(!/<f>WEBSERVICE/.test(xml), 'a function AMV does not evaluate is not written as one');
  const back = await page.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return amvReadFile(new File([bytes], 'ventas.xlsx')); }, d.buf.toString('base64'));
  ok(back.format === 'xlsx' && /B6 = SUM\(B2:B5\)/.test(back.data), 'and the file reads back as a workbook with its formulas', back.summary);
  await page.evaluate(() => _sheetClose());

  section('An Excel file attached in chat opens as a table, formulas included');
  await page.evaluate((att) => { S.att = att; showAttChip(); }, back);
  const label = await page.evaluate(() => (document.querySelector('#ac .att-open') || {}).textContent || '');
  ok(/table/i.test(label), 'the Excel chip offers Open as table', label);
  await page.click('#ac .att-open');
  await page.waitForSelector('#sh-scroll .sh-cell[data-r="5"]');
  ok(await cell(1, 5) === '550', 'and the total is a working formula again', await cell(1, 5));
  await page.evaluate(() => _sheetClose());
}

section('Asking AMV: honest when it cannot, and a change waits for Apply');
{
  await page.evaluate(() => openSheetEditor([['Item', 'Qty'], ['Pens', '3'], ['Ink', '7']], 'order.csv'));
  await page.waitForSelector('#sh-scroll .sh-cell');
  await page.evaluate(() => { window._aiBackendReady = () => false; });
  await page.fill('#sheet-inp', 'Which item sells most?');
  await page.click('#sheet-ask');
  const off = await page.evaluate(() => document.getElementById('sheet-res').textContent);
  ok(/isn’t connected yet/.test(off) && /work without it/.test(off), 'with no engine it says so, and what still works', off);
  await page.evaluate(() => {
    window._aiBackendReady = () => true;
    window.__prompts = [];
    window.aiComplete = async (p) => { window.__prompts.push(p); return 'Here it is:\n```csv\nItem,Qty\nPens,3\nInk,7\nPaper,10\n```\nAdded Paper.'; };
  });
  await page.fill('#sheet-inp', 'Add paper with 10');
  await page.click('#sheet-ask');
  await page.waitForSelector('#sh-apply');
  const sent = await page.evaluate(() => window.__prompts[0]);
  ok(/Pens,3/.test(sent) && /Add paper with 10/.test(sent), 'the question carries the table', sent.slice(0, 120));
  ok((await col(0)).join(',') === 'Pens,Ink', 'the table is unchanged until Apply', await col(0));
  await page.click('#sh-apply');
  ok((await col(0)).join(',') === 'Pens,Ink,Paper', 'Apply changes it', await col(0));
  await page.click('#sh-undo');
  ok((await col(0)).join(',') === 'Pens,Ink', 'and Undo takes it back', await col(0));
}

section('The background checks are no longer dead');
{
  const r = await page.evaluate(async () => {
    window._aiBackendReady = () => true;
    window.aiComplete = async () => 'done for real';
    const t = _bgAddTask({ title: 'Summarise my week', prompt: 'summarise' });
    for (let i = 0; i < 40 && t.status !== 'done' && t.status !== 'failed'; i++) await new Promise(r => setTimeout(r, 50));
    return { status: t.status, error: t.error || '', result: t.result || '' };
  });
  ok(r.status === 'done' && r.result === 'done for real', 'a queued task runs when the engine is reachable', r);
}

section('If the editor cannot be fetched, the screen says so and offers to try again');
{
  await page.evaluate(() => { delete window.amvSheet; _sheetP = null; });
  await page.route('**/sheet.js', r => r.abort());
  await page.evaluate(() => openSheetEditor([['a'], ['1']], 'x.csv'));
  await page.waitForSelector('#sh-retry', { timeout: 8000 });
  const msg = await page.evaluate(() => document.querySelector('.sh-body').textContent);
  ok(/could not be loaded/.test(msg), 'the failure is named', msg);
  await page.unroute('**/sheet.js');
  await page.click('#sh-retry');
  await page.waitForSelector('#sh-scroll .sh-cell', { timeout: 8000 });
  ok(true, 'and Try again opens it');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-spreadsheet-does-the-maths') > 0) process.exitCode = 1;
done();
