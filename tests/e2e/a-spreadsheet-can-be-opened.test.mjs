/* THE SPREADSHEET EDITOR HAD NO DOOR.

   openSheetEditor parses a CSV into a real table with an AI toolbar - analyse
   trends, find duplicates, add a totals row, download - and handleSheetFile is
   the only thing that opens it.

   Nothing called handleSheetFile. No file input anywhere in the product
   accepted a spreadsheet. So a complete, working feature was unreachable, and
   it had tests: tests/e2e/resilience asserts its error handling, which passed
   perfectly about a function nobody could run. A test that guards unreachable
   code is worse than no test, because it reads as coverage - LESSONS 296, the
   same shape as the Google front door that fell off.

   It has a door now, on the chat attachment chip, where files already arrive.
   Attaching stays the default because asking a question about a file is what
   the chat box is for; opening it as a table is offered ALONGSIDE, so nothing
   was taken away to add it.

   This suite is what stops the door falling off again: it puts a real CSV
   through the real chip and checks the editor opens with the real rows in it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'S', email: 's@x.com', ini: 'S' } });
const { page, errors } = app;

const CSV = 'Region,Units,Revenue\nNorth,120,4800\nSouth,95,3610\nEast,140,5320';

section('A CSV on the chip offers a way into the editor');
{
  const chip = await page.evaluate((csv) => {
    /* Set the way handleFiles sets it - a text attachment with the file's
       contents - rather than reaching into the editor directly. The point is
       the path a person takes. */
    S.att = { kind: 'text', name: 'sales.csv', size: csv.length, data: csv };
    showAttChip();
    const ac = document.getElementById('ac');
    const btn = ac && ac.querySelector('.att-open');
    return { shown: !!(document.getElementById('ab2') || {}).style,
             hasButton: !!btn, label: btn ? btn.textContent : '',
             named: !!(ac && /sales\.csv/.test(ac.textContent || '')) };
  }, CSV);
  ok(chip.named, 'the file is named on the chip', chip.named);
  ok(chip.hasButton, 'and a CSV gets a control to open it as a table', chip.hasButton);
  ok(/table/i.test(chip.label), 'labelled in words rather than an icon alone', chip.label);
}

section('And a file that is not a spreadsheet does not');
{
  /* The offer has to be about the file. Showing it on every attachment would
     mean pressing it on a PDF and getting an empty table or an error, which is
     worse than not offering. */
  const other = await page.evaluate(() => {
    const out = {};
    S.att = { kind: 'text', name: 'notes.txt', size: 10, data: 'hello' };
    showAttChip();
    out.txt = !!document.querySelector('#ac .att-open');
    S.att = { kind: 'pdf', name: 'contract.pdf', size: 10, b64: 'AA==' };
    showAttChip();
    out.pdf = !!document.querySelector('#ac .att-open');
    S.att = { kind: 'img', name: 'photo.png', size: 10, b64: 'AA==' };
    showAttChip();
    out.img = !!document.querySelector('#ac .att-open');
    return out;
  });
  ok(other.txt === false, 'a plain text file is not offered as a table', other.txt);
  ok(other.pdf === false, 'nor a PDF', other.pdf);
  ok(other.img === false, 'nor an image', other.img);
}

section('Pressing it opens the real editor, with the real rows');
{
  const opened = await page.evaluate(async (csv) => {
    S.att = { kind: 'text', name: 'sales.csv', size: csv.length, data: csv };
    showAttChip();
    const btn = document.querySelector('#ac .att-open');
    /* THE SAME SHAPE WHETHER OR NOT THE CONTROL IS THERE. Returning a bare
       {err} made every assertion below read a field that did not exist, so the
       suite threw a TypeError on the first one and the sections after it never
       ran - a second, unrelated defect would have been invisible behind the
       first. A test that dies reports less than a test that fails. */
    const blank = { err: 'no button to press', opened: false, named: false,
                    cells: [], rows: 0, hasDownload: false, hasAI: false };
    if (!btn) return blank;
    btn.click();
    /* handleSheetFile reads the file asynchronously, the same as it does for a
       real file input, so the table is not there on the next line. */
    const stop = Date.now() + 8000;
    while (Date.now() < stop) {
      if (document.querySelector('#vc table')) break;
      await new Promise(r => setTimeout(r, 40));
    }
    const vc = document.getElementById('vc');
    const table = vc && vc.querySelector('table');
    const cells = table ? [...table.querySelectorAll('td, th')].map(c => c.textContent.trim()) : [];
    return {
      opened: !!table,
      named: !!(vc && /sales\.csv/.test(vc.textContent || '')),
      cells,
      rows: table ? table.querySelectorAll('tr').length : 0,
      hasDownload: !!(vc && vc.querySelector('[data-dact="_sheetDownloadCSV"]')),
      hasAI: !!(vc && vc.querySelector('[data-dact="runSheetAI"]')),
    };
  }, CSV);

  ok(!opened.err, 'the control was there to press', opened.err || 'pressed');
  ok(opened.opened, 'the editor opened with a table in it', opened.opened);
  ok(opened.named, 'named after the file that was opened', opened.named);
  /* The real data, not an empty grid. A parser that returned nothing would
     still produce a <table>, and that is the failure worth catching. */
  ok(opened.cells.includes('Region') && opened.cells.includes('Revenue'),
     'carrying the real header row', opened.cells.slice(0, 4));
  ok(opened.cells.includes('South') && opened.cells.includes('3610'),
     'and the real data rows', opened.cells.slice(-4));
  ok(opened.rows === 4, 'every row, header plus three', opened.rows);
  ok(opened.hasDownload, 'with the download the editor offers', opened.hasDownload);
  ok(opened.hasAI, 'and the AI actions, so it is the whole feature and not a preview', opened.hasAI);
}

section('An unreadable file says so instead of opening an empty table');
{
  const bad = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast;
    window.toast = (m) => said.push(String(m));
    /* BACK TO CHAT FIRST. The editor renders into #vc by replacing it, and the
       attachment chip lives inside #vc too - so the previous section, by
       opening the editor, destroyed the very control this one needs. Clearing
       #vc by hand made it worse. Re-rendering chat is what a person does when
       they press Close, and it is what puts the composer back. */
    setTab('chat');
    await new Promise(r => setTimeout(r, 300));
    S.att = { kind: 'text', name: 'empty.csv', size: 0, data: '' };
    showAttChip();
    const btn = document.querySelector('#ac .att-open');
    /* Asserted, not skipped. `if (btn) btn.click()` quietly did nothing when
       the control was missing, so the check below reported "it said nothing"
       when the truth was "nothing was pressed" - two different failures with
       the same symptom. */
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 600));
    const out = { said, pressed: !!btn, table: !!document.querySelector('#vc table') };
    window.toast = realToast;
    return out;
  });
  ok(bad.pressed, 'the control was there to press', bad.pressed);
  ok(bad.table === false, 'nothing opens for a file with no rows', bad.table);
  ok(bad.said.some(m => /no readable rows|could not be read/i.test(m)),
     'and it says why, rather than doing nothing', bad.said);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('a-spreadsheet-can-be-opened') > 0) process.exitCode = 1;
done();
