/* "DONE" IS THE WORD THAT COSTS THE MOST WHEN IT IS WRONG.

   A build turn that says nothing about how far it got invites somebody to
   ship a page nobody has opened. A build turn that says "verified" invites
   it harder. So the line above the changelist reports only things that
   really happened during the turn, and then names the step nobody has done.

   THE FAILURE MODE THIS GUARDS is a verification line that is prose. It
   would be trivial to write "syntax checked, preview rendered, all good" on
   every turn and it would look exactly like this one - so every assertion
   below drives a real outcome and checks the line CHANGES with it. A line
   that says the same thing whatever happened is the bug.

   And the check that is deliberately absent is asserted too: there is no
   JavaScript syntax check, because parsing it in the page needs `eval`,
   which is precisely what AMV's own policy forbids. Claiming a check that
   is not running would be worse than the silence this replaced. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => setTab('dev'));
await page.waitForTimeout(350);

const verify = (changed, outcome) => page.evaluate(([c, o]) => {
  const v = _devVerify(c, o);
  return { texts: v.checks.map(x => (x.ok ? 'OK ' : 'NO ') + x.text), remaining: v.remaining };
}, [changed, outcome]);

section('It reports the run that really happened, not a run in general');
{
  const good = await verify([], { run: { ok: true, stdout: 'hi' } });
  ok(good.texts.some(t => /^OK .*ran without error/.test(t)),
     'a script that ran clean is reported as such', good.texts);

  const bad = await verify([], { run: { ok: false, stderr: 'ReferenceError: x is not defined\n  at line 3' } });
  ok(bad.texts.some(t => /^NO .*errored/.test(t)),
     'and one that failed is reported as failed, not skipped', bad.texts);
  ok(bad.texts.some(t => /ReferenceError: x is not defined/.test(t)),
     'with the actual error, so it is actionable', bad.texts);
  ok(!bad.texts.some(t => /at line 3/.test(t)),
     'and only the first line, so the card stays a summary', bad.texts);
}

section('The JSON check is real, because JSON is the one parser that needs no eval');
{
  const r = await page.evaluate(() => {
    _DEV.project = {};
    _devSetFile('good.json', '{"a":1}', 'json');
    _devSetFile('bad.json', '{"a":1,}', 'json');
    const okOnly = _devVerify(['good.json'], {});
    const withBad = _devVerify(['good.json', 'bad.json'], {});
    return { okOnly: okOnly.checks.map(c => (c.ok ? 'OK ' : 'NO ') + c.text),
             withBad: withBad.checks.map(c => (c.ok ? 'OK ' : 'NO ') + c.text) };
  });
  ok(r.okOnly.some(t => /^OK .*JSON file parses/.test(t)),
     'valid JSON passes', r.okOnly);
  ok(r.withBad.some(t => /^NO .*did not parse: bad\.json/.test(t)),
     'and a file that does not parse is named', r.withBad);
}

section('It never claims a JavaScript syntax check, because it cannot run one');
{
  /* The page pins script-src to hashes and allows no eval, so `new Function`
     is refused - which is the policy working. A line claiming JavaScript was
     checked would be the dishonest kind of green. */
  const r = await page.evaluate(() => {
    _DEV.project = {};
    _devSetFile('broken.js', 'function ( { { {', 'js');
    const v = _devVerify(['broken.js'], {});
    return v.checks.map(c => c.text);
  });
  ok(!r.some(t => /syntax|parses|JavaScript/i.test(t)),
     'nothing is said about the JavaScript, because nothing was done to it', r);
}

section('What has NOT been done is always said, and it changes with the turn');
{
  const drawn = await verify([], { previewed: true });
  ok(/clicked through/i.test(drawn.remaining),
     'a page that rendered still needs somebody to use it', drawn.remaining);

  const nothing = await verify([], {});
  ok(/Nothing was run/i.test(nothing.remaining),
     'and a turn that ran nothing says exactly that', nothing.remaining);
  ok(drawn.remaining !== nothing.remaining,
     'the two are different sentences, so this is not one line printed always',
     [drawn.remaining, nothing.remaining]);
}

section('Rendering it, above the changelist');
{
  const shown = await page.evaluate(async () => {
    _DEV.project = {}; _DEV.log = [];
    _devSetFile('index.html', '<h1>x</h1>', 'html');
    _DEV.log.push({ role: 'ai', text: 'done',
                    changes: [{ path: 'index.html', kind: 'edited', add: 1, del: 0 }],
                    verify: _devVerify(['index.html'], { previewed: true }) });
    _devRenderLog();
    await new Promise(s => setTimeout(s, 250));
    const wrap = document.querySelector('#dev-log .dev-msg-ai');
    const v = wrap.querySelector('.dvv'), c = wrap.querySelector('.dvc');
    return {
      present: !!v,
      /* Order matters: what was checked, then what changed. Reading the
         changelist first and the caveat after is the wrong way round. */
      before: !!(v && c) && (v.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      text: v ? v.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  });
  ok(shown.present, 'the verification block is on the turn', shown.present);
  ok(shown.before, 'and sits above the changelist', shown.before);
  ok(/rendered in the preview/.test(shown.text) && /clicked through/i.test(shown.text),
     'saying both halves: what ran, and what nobody has done', shown.text.slice(0, 120));
}

section('The turn really attaches it, from what the work reported');
{
  /* The seam. `_devVerify` can be perfect while the turn never calls it, or
     calls it with invented arguments instead of the outcome of the work. */
  const wired = await page.evaluate(() => {
    const after = String(window._devAfterWrite);
    /* Minified in the page, so this looks for the property names rather than
       any particular spelling of the code around them. */
    return { reports: /previewed/.test(after) && /saved/.test(after) };
  });
  ok(wired.reports,
     'the after-write step reports what it did rather than returning nothing',
     wired.reports);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('what-was-checked-and-what-was-not') > 0) process.exitCode = 1;
done();
