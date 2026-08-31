/* "IT SHOWS YOU THE FILES CHANGED AT THE END, WITH THE +52 -1."

   A Dev turn used to finish by appending a sentence - "**Files changed:**
   a.js, b.css" - to the end of a paragraph. That names the files and says
   nothing else: not how much of each one moved, not whether a file was
   created, and above all not how to put it back. A build tool whose only
   answer to "that was wrong" is "ask again and hope" is one people stop
   pointing at a project they care about.

   THE TWO WAYS THIS COULD BE GREEN AND WRONG, both guarded below:

   A card that renders is not a card that is correct. The numbers are the
   whole point - they are what somebody uses to decide whether to read the
   diff - so the counts are checked against diffs whose answers are known by
   hand, not against whatever the code happens to produce.

   And a card the turn never builds is a card nobody sees. The renderer can
   be perfect while `_devSend` still writes the old sentence, which is the
   single most common defect in this codebase: correct at both ends and not
   joined in the middle. So the seam is checked in the source too. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The line counts are real, measured against diffs worked out by hand');
{
  /* A pure function, so these can assert exact numbers rather than "looks
     about right". Each case is one somebody could check with a pencil. */
  const got = await page.evaluate(() => ({
    /* Nothing changed at all. */
    same: _diffStat('a\nb\nc', 'a\nb\nc'),
    /* One line replaced in the middle: one out, one in. */
    swap: _diffStat('a\nb\nc', 'a\nB\nc'),
    /* Two lines appended, nothing removed. */
    grow: _diffStat('a\nb', 'a\nb\nc\nd'),
    /* One line taken out of the middle. */
    cut: _diffStat('a\nb\nc\nd', 'a\nb\nd'),
    /* A brand new file: every line is an addition. */
    born: _diffStat('', 'x\ny\nz'),
    /* A deleted file: every line is a removal. */
    gone: _diffStat('x\ny\nz', ''),
    /* Nothing in common, so the whole thing is out and the whole thing in. */
    rewrite: _diffStat('a\nb\nc', 'x\ny'),
    /* The case the prefix and suffix trim exists for: one line changed deep
       inside a long file must not report the whole file as churn. */
    deep: (() => {
      const a = Array.from({ length: 400 }, (_, i) => 'line ' + i);
      const b = a.slice(); b[200] = 'CHANGED';
      return _diffStat(a.join('\n'), b.join('\n'));
    })(),
  }));
  const is = (o, add, del) => o && o.add === add && o.del === del;
  ok(is(got.same, 0, 0), 'an unchanged file is 0 and 0', got.same);
  ok(is(got.swap, 1, 1), 'a replaced line is one in and one out', got.swap);
  ok(is(got.grow, 2, 0), 'two appended lines add two and remove nothing', got.grow);
  ok(is(got.cut, 0, 1), 'a deleted line removes one and adds nothing', got.cut);
  ok(is(got.born, 3, 0), 'a new file is all additions', got.born);
  ok(is(got.gone, 0, 3), 'a removed file is all removals', got.gone);
  ok(is(got.rewrite, 2, 3), 'a rewrite counts both sides', got.rewrite);
  ok(is(got.deep, 1, 1), 'one line deep in a 400-line file is 1 and 1, not 400',
     got.deep);
}

section('A file rewritten to exactly what it already said is not a change');
{
  /* The padding failure. A model handed back the same bytes has not changed
     the file, and listing it inflates the only number on the card people
     are trusting. */
  const rows = await page.evaluate(() => {
    const before = { 'a.js': 'x\ny', 'b.css': 'p{}' };
    const after = { 'a.js': 'x\ny', 'b.css': 'p{color:red}' };
    return _devChangeSet(before, after);
  });
  ok(rows.length === 1, 'only the file that really moved is listed', rows.map(r => r.path));
  ok(rows[0].path === 'b.css', 'and it is the right one', rows[0].path);
}

section('The card says what changed, and the totals are the sum of the rows');
{
  const card = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(r => setTimeout(r, 300));
    /* Built through the real functions rather than by writing markup: the
       snapshot, the write, the change set and the record are the same calls
       a turn makes. */
    _DEV.project = {}; _DEV.log = [];
    _devSetFile('index.html', '<h1>one</h1>', 'html');
    const before = _devSnapshot();
    _devSetFile('index.html', '<h1>one</h1>\n<p>two</p>', 'html');
    _devSetFile('app.js', 'console.log(1)\nconsole.log(2)', 'js');
    const after = _devSnapshot();
    const rows = _devChangeSet(before, after);
    _DEV.log.push({ role: 'ai', text: 'Did the thing.', changes: rows,
                    chgId: _devRecordTurn(before, after) });
    _devRenderLog();
    await new Promise(r => setTimeout(r, 200));
    const el = document.querySelector('#dev-log .dvc');
    return {
      present: !!el,
      head: el ? el.querySelector('.dvc-head').textContent.replace(/\s+/g, ' ').trim() : '',
      /* Read as elements, not out of the concatenated text: the header's
         spans sit side by side with a CSS gap and no separator between
         them, so a regex over textContent is matching a run-together
         string and is one boundary away from being wrong about it. */
      headAdd: el ? el.querySelector('.dvc-head .dvc-add').textContent : '',
      headDel: el ? el.querySelector('.dvc-head .dvc-del').textContent : '',
      rows: el ? [...el.querySelectorAll('.dvc-row')].map(r => ({
        path: r.querySelector('.dvc-path').textContent,
        add: r.querySelector('.dvc-add').textContent,
        del: r.querySelector('.dvc-del').textContent,
      })) : [],
    };
  });
  ok(card.present, 'the turn ends with a changelist card', card.present);
  ok(/2 files changed/.test(card.head), 'it counts the files', card.head);
  /* index.html gained one line; app.js is new and has two. Three added,
     none removed - and the header must agree with the rows rather than
     being computed some other way. */
  ok(card.headAdd === '+3' && card.headDel === '-0',
     'and the totals are the sum of the rows', card.headAdd + ' ' + card.headDel);
  ok(card.rows.length === 2, 'both files are listed', card.rows.length);
  const byPath = Object.fromEntries(card.rows.map(r => [r.path, r]));
  ok(byPath['app.js'] && byPath['app.js'].add === '+2',
     'a new file shows its real size', byPath['app.js']);
  ok(byPath['index.html'] && byPath['index.html'].add === '+1' && byPath['index.html'].del === '-0',
     'and an edited one shows only what moved', byPath['index.html']);
}

section('Undo really puts the files back, and it is reversible');
{
  /* Asserted on the CONTENT of the project, not on the card's own label. A
     card that says "Undo" and changes nothing is exactly the failure this
     is here to catch. */
  const r = await page.evaluate(async () => {
    const read = () => Object.fromEntries(
      Object.keys(_DEV.project).sort().map(p => [p, _DEV.project[p].content]));
    const afterTurn = read();
    document.querySelector('#dev-log .dvc-undo').click();
    await new Promise(s => setTimeout(s, 250));
    const undone = read();
    document.querySelector('#dev-log .dvc-undo').click();
    await new Promise(s => setTimeout(s, 250));
    return { afterTurn, undone, redone: read(),
             label: document.querySelector('#dev-log .dvc-undo').textContent.trim() };
  });
  ok(r.undone['index.html'] === '<h1>one</h1>',
     'the edited file goes back to what it said before the turn', r.undone['index.html']);
  ok(!('app.js' in r.undone),
     'and a file the turn created is removed, not left empty', Object.keys(r.undone));
  ok(JSON.stringify(r.redone) === JSON.stringify(r.afterTurn),
     'redo restores the change exactly', Object.keys(r.redone));
  ok(/Undo/i.test(r.label), 'and the button offers Undo again', r.label);
}

section('A row opens the file it names');
{
  const opened = await page.evaluate(async () => {
    document.querySelector('#dev-log .dvc-row[data-dvc-open="app.js"]').click();
    await new Promise(s => setTimeout(s, 250));
    return { active: _DEV.activePath,
             onCode: document.getElementById('dev-code-body').style.display !== 'none' };
  });
  ok(opened.active === 'app.js', 'clicking a row makes that file the open one', opened.active);
  ok(opened.onCode, 'and puts the code pane on screen, where the file is', opened.onCode);
}

section('The turn really builds the card - the seam, not just the renderer');
{
  /* The renderer above can be perfect while `_devSend` still appends the old
     sentence, and every check in this file would stay green. So the source
     is read: the turn must take a snapshot before it writes and hand the
     measured change set to the log entry. */
  const src = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  const body = functionBody(src, '_devSend');
  ok(body.length > 500, 'the turn function was found, so this has a subject', body.length);
  ok(/_devSnapshot\(\)/.test(body),
     'it snapshots the project before writing anything', /_devSnapshot/.test(body));
  ok(/_devChangeSet\(/.test(body) && /_devRecordTurn\(/.test(body),
     'and ends the turn with a measured change set it can undo', true);
  /* Anchored on the CODE that built the old sentence - `changed.join(', ')`
     appended to the entry text - rather than on the words it produced. A
     check that greps for the prose is a check about an explanation, and this
     repo has a suite whose whole job is catching that. */
  ok(!/changed\.join\(/.test(body),
     'the sentence that used to stand in for this is gone, not left beside it',
     /changed\.join\(/.test(body));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-build-turn-ends-with-a-changelist') > 0) process.exitCode = 1;
done();
