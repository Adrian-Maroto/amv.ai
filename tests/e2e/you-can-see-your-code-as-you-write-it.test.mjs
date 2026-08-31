/* "YOU CAN ALWAYS SEE A PREVIEW OF ALL YOUR CODE IN REAL TIME."

   Two things were in the way, and neither was the preview.

   The code pane was a `<pre>`. You could read the file AMV wrote and copy
   it, and to change one character you had to ask the model to do it for
   you - which costs a turn, costs money, and can come back having rewritten
   three other things you did not mention. There was no "as you write it",
   because there was no writing.

   And code pasted into the composer went to the model as a prompt. Four
   hundred lines of somebody's file came back paraphrased, and the file they
   actually wanted to work on was never in the project at all.

   THE TRAP HERE is asserting that a textarea exists. A textarea whose edits
   go nowhere looks identical in a screenshot and passes that check. So every
   assertion below reads the PROJECT and the PREVIEW after typing, not the
   markup. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* The frame the preview really renders into, reached through the debugging
   protocol - the parent cannot see inside it, correctly. */
const previewText = async (sel) => {
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    try {
      const t = await fr.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? el.textContent : null;
      }, sel);
      if (t !== null) return t;
    } catch (e) { /* not this one */ }
  }
  return null;
};

section('The code pane can be typed into at all');
{
  const r = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    _DEV.project = {}; _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('index.html', '<h1 id="t">first</h1>', 'html');
    _devRenderLog();
    document.getElementById('dev-tab-code').click();
    await new Promise(s => setTimeout(s, 300));
    const ed = document.getElementById('dev-code-ed');
    return { editable: !!ed && ed.tagName === 'TEXTAREA' && !ed.readOnly,
             shows: ed ? ed.value : '',
             /* Not innerHTML: this is somebody's file and it is usually
                markup. A pane that renders it would be a live XSS. */
             notRendered: !!ed && ed.innerHTML.indexOf('<h1') === -1 };
  });
  ok(r.editable, 'the code pane is an editable field, not a block of text', r.editable);
  ok(r.shows === '<h1 id="t">first</h1>', 'showing the file', r.shows);
  ok(r.notRendered, 'as a value, so pasted markup is never rendered into the page', r.notRendered);
}

section('Typing changes the project, and the preview follows without a turn');
{
  const r = await page.evaluate(async () => {
    const ed = document.getElementById('dev-code-ed');
    ed.value = '<h1 id="t">edited by hand</h1>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    /* Long enough for the debounce, which exists so a fast typist is not
       re-assembling the page on every keystroke. */
    await new Promise(s => setTimeout(s, 900));
    return { inProject: _DEV.project['index.html'].content,
             note: (document.getElementById('dev-code-saved') || {}).textContent || '' };
  });
  ok(r.inProject === '<h1 id="t">edited by hand</h1>',
     'what you typed is what the project holds', r.inProject);

  await page.evaluate(async () => {
    document.getElementById('dev-tab-prev').click();
    await new Promise(s => setTimeout(s, 900));
  });
  await page.waitForTimeout(700);
  const shown = await previewText('#t');
  ok(shown === 'edited by hand',
     'and the preview shows the edit, with no build turn spent', shown);
}

section('Pasted code is recognised as code');
{
  /* Signals rather than one regex, so this checks both directions: real code
     is spotted, and a long piece of prose is not dragged into the project. */
  const r = await page.evaluate(() => {
    const js = ['function greet(name) {', '  const msg = "hi " + name;',
                '  return msg.toUpperCase();', '}', 'const out = greet("world");',
                'console.log(out);', 'export default greet;'].join('\n') + '\n'.padEnd(220, ' ');
    const prose = ('This is a long note about what I want you to build for me. '
      + 'It should have a header and a footer and a signup form somewhere in the middle. '
      + 'Please make it look modern and friendly, and use our brand colours throughout. '
      + 'I would like it to work on a phone as well as on a laptop, and to load quickly.\n')
      .repeat(2) + 'One more line.\nAnd another.\nAnd a third.\nAnd a fourth.\nAnd a fifth.';
    return {
      js: _looksLikeCode(js), prose: _looksLikeCode(prose),
      short: _looksLikeCode('const a = 1;'),
      nameHtml: _guessFileName('<!doctype html>\n<html><body><p>x</p></body></html>'),
      nameCss: _guessFileName('.card {\n  color: red;\n}\n#main {\n  padding: 4px;\n}'),
      namePy: _guessFileName('import os\n\ndef main():\n    print("x")\n\nmain()'),
      nameJs: _guessFileName(js),
    };
  });
  ok(r.js, 'a block of JavaScript is recognised', r.js);
  ok(!r.prose, 'and a long description of what to build is NOT', r.prose);
  ok(!r.short, 'nor is a single line somebody is quoting mid-sentence', r.short);
  ok(r.nameHtml === 'index.html' && r.nameCss === 'styles.css'
     && r.namePy === 'main.py' && r.nameJs === 'app.js',
     'and each gets a name somebody would recognise', r);
}

section('The offer is an offer, and saying no leaves the text alone');
{
  const r = await page.evaluate(async () => {
    const ta = document.getElementById('dev-msg');
    const code = ['<!doctype html>', '<html><head><style>', 'body{background:#111;color:#eee}',
                  '</style></head><body>', '<h1 id="p">pasted page</h1>',
                  '<script>document.getElementById("p").textContent="pasted and running"</scr' + 'ipt>',
                  '</body></html>'].join('\n').padEnd(230, ' ');
    ta.value = code;
    ta.dispatchEvent(new Event('paste', { bubbles: true }));
    await new Promise(s => setTimeout(s, 250));
    const host = document.getElementById('dev-paste-offer');
    const before = { shown: !host.hidden, label: (document.getElementById('dev-paste-add') || {}).textContent || '' };
    document.getElementById('dev-paste-no').click();
    await new Promise(s => setTimeout(s, 150));
    return { before, afterHidden: host.hidden, textKept: ta.value === code,
             filesUntouched: Object.keys(_DEV.project).sort().join(',') };
  });
  ok(r.before.shown, 'pasting code offers to add it as a file', r.before.shown);
  ok(/index\.html/.test(r.before.label), 'naming the file it would create', r.before.label);
  ok(r.afterHidden, 'declining puts the offer away', r.afterHidden);
  ok(r.textKept, 'and leaves what you pasted exactly where it was', r.textKept);
  ok(r.filesUntouched === 'index.html',
     'with nothing added behind your back', r.filesUntouched);
}

section('Accepting it adds the file and the preview shows it running');
{
  await page.evaluate(async () => {
    _DEV.project = {};
    const ta = document.getElementById('dev-msg');
    ta.value = ['<!doctype html>', '<html><body>', '<h1 id="p">…</h1>',
                '<script>document.getElementById("p").textContent="pasted and running"</scr' + 'ipt>',
                '</body></html>', '', '', ''].join('\n').padEnd(240, ' ');
    ta.dispatchEvent(new Event('paste', { bubbles: true }));
    await new Promise(s => setTimeout(s, 250));
    document.getElementById('dev-paste-add').click();
    await new Promise(s => setTimeout(s, 200));
    /* The name is asked for, so this answers the prompt the way a person
       would - by accepting the suggestion. */
    const ok = [...document.querySelectorAll('button')].find(b => /^(ok|save|confirm|continue)$/i.test(b.textContent.trim()));
    if (ok) ok.click();
    await new Promise(s => setTimeout(s, 900));
  });
  await page.waitForTimeout(900);
  const added = await page.evaluate(() => ({
    files: Object.keys(_DEV.project),
    box: document.getElementById('dev-msg').value,
  }));
  ok(added.files.includes('index.html'), 'the pasted page becomes a file', added.files);
  ok(added.box === '', 'and the composer is cleared, because it was not a message', added.box);

  const ran = await previewText('#p');
  ok(ran === 'pasted and running',
     'and the preview runs it, rather than drawing a picture of it', ran);
}

section('Undo after a hand edit does not throw the hand edit away');
{
  /* The snapshot taken at the end of a turn is what the TURN produced. What
     is in the project now is what the person has since made of it, and that
     is what Redo has to bring back - otherwise undo is a trap for anybody
     who touched a file afterwards. */
  const r = await page.evaluate(async () => {
    _DEV.project = {}; _DEV.log = [];
    _devSetFile('a.txt', 'original', 'txt');
    const before = _devSnapshot();
    _devSetFile('a.txt', 'from the turn', 'txt');
    const id = _devRecordTurn(before, _devSnapshot());
    _DEV.log.push({ role: 'ai', text: 'x',
                    changes: _devChangeSet(before, _devSnapshot()), chgId: id });
    _devRenderLog();
    await new Promise(s => setTimeout(s, 200));
    /* A hand edit lands after the turn. */
    _DEV.project['a.txt'].content = 'then I fixed it by hand';
    document.querySelector('#dev-log .dvc-undo').click();
    await new Promise(s => setTimeout(s, 250));
    const undone = _DEV.project['a.txt'].content;
    document.querySelector('#dev-log .dvc-undo').click();
    await new Promise(s => setTimeout(s, 250));
    return { undone, redone: _DEV.project['a.txt'].content };
  });
  ok(r.undone === 'original', 'undo still goes back to before the turn', r.undone);
  ok(r.redone === 'then I fixed it by hand',
     'and redo brings back what you had, not what the model wrote', r.redone);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('you-can-see-your-code-as-you-write-it') > 0) process.exitCode = 1;
done();
