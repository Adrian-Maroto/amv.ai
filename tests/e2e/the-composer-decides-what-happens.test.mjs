/* THE THREE DECISIONS SOMEBODY MAKES WHEN THEY PRESS SEND.

   What to attach, whether the change lands by itself, and which engine at
   what effort. Two of those lived in the toolbar that describes the whole
   surface - so "which engine writes this message" sat next to "New session",
   two feet from the box you type the message in - and one of them, the change
   mode, did not exist at all.

   THE FAILURE THIS FILE EXISTS FOR is a mode that is a label. "Ask before
   changes" is worth nothing if the files have already been written by the
   time the card appears, and a screenshot cannot tell the difference. So the
   checks below read the PROJECT, not the card: in ask mode the files must be
   untouched until Apply is pressed, and the card must not claim otherwise.

   The effort picker has the same shape of risk in the other direction - it is
   a spend lever, so a control that offers a setting the plan cannot have is
   an invitation to a bill somebody did not agree to. Its ceiling is enforced
   on the server (worker/effort-cannot-outrun-the-plan) and this checks the
   courtesy half: that the picker says so up front rather than letting
   somebody choose it and quietly getting something else. */
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

const openDev = async () => {
  await page.evaluate(async () => { setTab('dev'); });
  await page.waitForTimeout(350);
};
await openDev();

section('Every control is in the composer, where the decision is');
{
  const where = await page.evaluate(() => {
    const inComposer = (id) => {
      const el = document.getElementById(id);
      return !!(el && el.closest('.dev-input'));
    };
    return {
      plus: inComposer('dev-add'),
      mode: inComposer('dev-apply-mode'),
      engine: inComposer('dev-model'),
      effort: inComposer('dev-effort'),
      send: inComposer('dev-send'),
      /* And gone from the bar it used to clutter, rather than duplicated
         into two places that can disagree. */
      barCopies: document.querySelectorAll('.dev-bar #dev-model, .dev-bar #dev-add').length,
    };
  });
  ok(where.plus, 'the attach button is in the composer', where.plus);
  ok(where.mode, 'so is the change mode', where.mode);
  ok(where.engine, 'and the engine picker', where.engine);
  ok(where.effort, 'and the effort picker', where.effort);
  ok(where.send, 'beside the send button', where.send);
  ok(where.barCopies === 0, 'and nothing was left behind in the toolbar', where.barCopies);
}

section('The attach button still opens the thing it always opened');
{
  /* It moved. A moved control that stopped working is the ordinary cost of
     moving one, so the menu is opened for real rather than assumed. */
  const r = await page.evaluate(async () => {
    document.getElementById('dev-add').click();
    await new Promise(s => setTimeout(s, 150));
    const m = document.getElementById('dev-add-menu');
    return { shown: !!m && m.style.display !== 'none',
             items: m ? [...m.querySelectorAll('[data-add]')].map(b => b.dataset.add) : [],
             expanded: document.getElementById('dev-add').getAttribute('aria-expanded'),
             inputs: !!document.getElementById('dev-files') && !!document.getElementById('dev-folderinput') };
  });
  ok(r.shown, 'the add menu opens', r.shown);
  ok(r.items.join(',') === 'files,folder,connect', 'with all three ways in', r.items);
  ok(r.expanded === 'true', 'and the button says it is open, to a screen reader too', r.expanded);
  ok(r.inputs, 'the file inputs moved with it, so the menu items reach something', r.inputs);
  await page.evaluate(() => document.getElementById('dev-add').click());
}

section('Ask before changes means nothing has been written');
{
  /* Driven through the real staging function with a real parsed write, then
     asserted on the PROJECT. A card that appears while the files have
     already changed is the whole failure. */
  const staged = await page.evaluate(async () => {
    _DEV.project = {}; _DEV.log = [];
    _devSetFile('index.html', '<h1>before</h1>', 'html');
    const before = _devSnapshot();
    const writes = [{ path: 'index.html', body: '<h1>after</h1>' },
                    { path: 'app.js', body: 'let a=1\nlet b=2' }];
    const proposed = Object.assign({}, before);
    for (const w of writes) proposed[w.path] = w.body;
    const id = _devStageTurn(before, proposed, writes);
    _DEV.log.push({ role: 'ai', text: 'Here is what I would change.',
                    changes: _devChangeSet(before, proposed), chgId: id });
    _devRenderLog();
    await new Promise(s => setTimeout(s, 200));
    const card = document.querySelector('#dev-log .dvc');
    return {
      onDisk: Object.fromEntries(Object.keys(_DEV.project).map(p => [p, _DEV.project[p].content])),
      hasApply: !!card.querySelector('[data-dvc-apply]'),
      hasDiscard: !!card.querySelector('[data-dvc-discard]'),
      hasUndo: !!card.querySelector('[data-dvc-undo]'),
      head: card.querySelector('.dvc-n').textContent,
      note: (card.querySelector('.dvc-note') || {}).textContent || '',
    };
  });
  ok(staged.onDisk['index.html'] === '<h1>before</h1>',
     'the file still says what it said', staged.onDisk['index.html']);
  ok(!('app.js' in staged.onDisk),
     'and the new file has not been created', Object.keys(staged.onDisk));
  ok(staged.hasApply && staged.hasDiscard, 'the card asks rather than reports', staged);
  ok(!staged.hasUndo, 'and offers no Undo for something that has not happened', staged.hasUndo);
  ok(/to change/.test(staged.head),
     'the wording says these are proposed, not done', staged.head);
  ok(/Nothing has been written yet/i.test(staged.note),
     'and says so in words', staged.note.slice(0, 60));
}

section('A row shows what the file would say, because that is the question');
{
  /* On a staged card the file does not exist yet, so opening it would show
     nothing for an added file and the OLD text for an edited one - the worst
     answer available. It shows the proposal instead. */
  const peek = await page.evaluate(async () => {
    document.querySelector('#dev-log .dvc-row[data-dvc-peek="app.js"]').click();
    await new Promise(s => setTimeout(s, 200));
    const pre = document.querySelector('#dev-log .dvc-peek');
    return { text: pre ? pre.textContent : '',
             expanded: document.querySelector('#dev-log .dvc-row[data-dvc-peek="app.js"]').getAttribute('aria-expanded') };
  });
  ok(peek.text === 'let a=1\nlet b=2', 'the proposed content is shown', peek.text);
  ok(peek.expanded === 'true', 'and the row says it is open', peek.expanded);
}

section('Apply writes it, and only then');
{
  const applied = await page.evaluate(async () => {
    document.querySelector('#dev-log [data-dvc-apply]').click();
    await new Promise(s => setTimeout(s, 500));
    const card = document.querySelector('#dev-log .dvc');
    return {
      onDisk: Object.fromEntries(Object.keys(_DEV.project).map(p => [p, _DEV.project[p].content])),
      hasUndo: !!card.querySelector('[data-dvc-undo]'),
      hasApply: !!card.querySelector('[data-dvc-apply]'),
      head: card.querySelector('.dvc-n').textContent,
    };
  });
  ok(applied.onDisk['index.html'] === '<h1>after</h1>', 'the edit lands', applied.onDisk['index.html']);
  ok(applied.onDisk['app.js'] === 'let a=1\nlet b=2', 'and the new file is created', !!applied.onDisk['app.js']);
  ok(applied.hasUndo && !applied.hasApply,
     'and the card becomes the one you can undo', applied);
  ok(/changed/.test(applied.head) && !/to change/.test(applied.head),
     'with the wording following the state', applied.head);
}

section('Discard writes nothing at all');
{
  const discarded = await page.evaluate(async () => {
    _DEV.project = {}; _DEV.log = [];
    _devSetFile('keep.txt', 'original', 'txt');
    const before = _devSnapshot();
    const writes = [{ path: 'keep.txt', body: 'replaced' }];
    const proposed = { 'keep.txt': 'replaced' };
    const id = _devStageTurn(before, proposed, writes);
    _DEV.log.push({ role: 'ai', text: 'x', changes: _devChangeSet(before, proposed), chgId: id });
    _devRenderLog();
    await new Promise(s => setTimeout(s, 200));
    document.querySelector('#dev-log [data-dvc-discard]').click();
    await new Promise(s => setTimeout(s, 250));
    const card = document.querySelector('#dev-log .dvc');
    return { content: _DEV.project['keep.txt'].content,
             note: (card.querySelector('.dvc-note') || {}).textContent || '',
             hasApply: !!card.querySelector('[data-dvc-apply]') };
  });
  ok(discarded.content === 'original', 'the file is untouched', discarded.content);
  ok(/Discarded/i.test(discarded.note), 'and the card says so', discarded.note);
  ok(!discarded.hasApply, 'with no way to apply it by accident afterwards', discarded.hasApply);
}

section('Apply automatically really skips the question');
{
  const auto = await page.evaluate(async () => {
    const sel = document.getElementById('dev-apply-mode');
    sel.value = 'auto';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(s => setTimeout(s, 150));
    /* Read back through the same function the turn reads, not the widget -
       a select that changes nothing is the failure being ruled out. */
    return { stored: _devApplyMode() };
  });
  ok(auto.stored === 'auto', 'the choice is what the turn will read', auto.stored);

  const persists = await page.evaluate(async () => {
    setTab('chat'); await new Promise(s => setTimeout(s, 200));
    setTab('dev'); await new Promise(s => setTimeout(s, 350));
    return { value: document.getElementById('dev-apply-mode').value, stored: _devApplyMode() };
  });
  ok(persists.value === 'auto' && persists.stored === 'auto',
     'and it survives leaving the surface and coming back', persists);
  await page.evaluate(() => { _devSetApplyMode('ask'); });
}

section('The effort picker cannot offer what the plan will not give');
{
  const free = await page.evaluate(async () => {
    saveStr('amv_plan', 'free');
    setTab('chat'); await new Promise(s => setTimeout(s, 150));
    setTab('dev'); await new Promise(s => setTimeout(s, 350));
    const sel = document.getElementById('dev-effort');
    return [...sel.options].map(o => ({ v: o.value, disabled: o.disabled, t: o.textContent }));
  });
  const high = free.find(o => o.v === 'high');
  const mid = free.find(o => o.v === 'medium');
  ok(high && high.disabled, 'on a free plan the paid step is not selectable', high);
  ok(/Elite/.test(high.t), 'and it says which plan it belongs to', high.t);
  ok(mid && !mid.disabled,
     'while asking for less is open to everybody, because it only saves money', mid);

  const elite = await page.evaluate(async () => {
    saveStr('amv_plan', 'elite');
    setTab('chat'); await new Promise(s => setTimeout(s, 150));
    setTab('dev'); await new Promise(s => setTimeout(s, 350));
    const sel = document.getElementById('dev-effort');
    const h = [...sel.options].find(o => o.value === 'high');
    sel.value = 'high';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(s => setTimeout(s, 150));
    return { disabled: h.disabled, stored: _devEffort() };
  });
  ok(!elite.disabled, 'a plan that pays for it can pick it', elite.disabled);
  ok(elite.stored === 'high', 'and the choice is what the turn will send', elite.stored);
  await page.evaluate(() => { _devSetEffort(''); saveStr('amv_plan', 'free'); });
}

section('The turn really sends the effort and shows it is working');
{
  /* The seam again. A picker that stores a value nothing reads is the same
     defect as a mode that is a label.

     Read from the file on disk, NOT from `String(window._devSend)`. The page
     runs the MINIFIED bundle, where `_devBusy(true)` is `_devBusy(!0)` - so a
     regex against the live function is matching whatever the minifier felt
     like emitting, and the first version of this check failed on correct
     code for exactly that reason. */
  const src = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  const body = functionBody(src, '_devSend');
  ok(body.length > 500, 'the turn function was found, so this has a subject', body.length);
  ok(/effort:\s*_devEffort\(\)/.test(body),
     'the turn passes the chosen effort to the engine', /effort/.test(body));
  ok(/_devBusy\(true/.test(body) && /_devBusy\(false\)/.test(body),
     'and it says when it is working, and stops saying it', true);

  /* And the indicator itself does something, rather than being a hidden
     element nobody ever unhides. */
  const shown = await page.evaluate(async () => {
    _devBusy(true, 'Building');
    await new Promise(s => setTimeout(s, 60));
    const el = document.getElementById('dev-busy');
    const on = { hidden: el.hidden, text: el.textContent.trim(),
                 sendOff: document.getElementById('dev-send').disabled };
    _devBusy(false);
    await new Promise(s => setTimeout(s, 60));
    return { on, offHidden: el.hidden, sendBack: !document.getElementById('dev-send').disabled };
  });
  ok(!shown.on.hidden && /Building/.test(shown.on.text),
     'working says so in words, not only with a spinner', shown.on);
  ok(shown.on.sendOff, 'and send is held while it runs, so a turn cannot be doubled', shown.on.sendOff);
  ok(shown.offHidden && shown.sendBack, 'and both come back afterwards', shown);
}

section('Nothing that says it is hidden is actually on screen');
{
  /* TWO OF THESE SHIPPED. `[hidden]` is a UA-stylesheet rule, so ANY author
     rule that sets `display` outranks it - and both new composer pieces set
     one. The paste offer rendered as a permanently visible empty accent bar
     under the box you type in, and the busy spinner sat there with its
     infinite animation running on every Dev view, forever, invisible only
     because it was small.

     Neither overflowed, neither was too small to tap, and no check in this
     repo could see them. This one can, and it is written against every
     element on the surface rather than the two that were wrong, so the next
     one is caught the day it is added. */
  const shown = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    return [...document.querySelectorAll('#vc [hidden]')]
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => el.tagName.toLowerCase() + '#' + el.id + '.' + String(el.className).split(' ')[0]);
  });
  ok(shown.length === 0,
     'every element carrying the hidden attribute really is display:none', shown);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-composer-decides-what-happens') > 0) process.exitCode = 1;
done();
