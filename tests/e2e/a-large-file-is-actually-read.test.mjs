/* "MAKE SURE YOU CAN ACTUALLY UPLOAD A FILE OVER LIKE 10,000 LINES."

   Measured before changing anything, which is the only way this was going to
   be understood, because the surface behaved differently depending on how
   WIDE the lines were:

     10,000 lines at normal width  = 544KB  -> loaded
     10,000 lines at ninety cols   = 1.0MB  -> vanished
     50,000 lines                  = 2.8MB  -> vanished

   The ceiling was 800,000 bytes, and a file over it was skipped by an `if`
   with no else: nothing recorded, nothing said, and the toast underneath
   announced "Loaded 0 files" as a SUCCESS. A success message about zero files
   is worse than an error - it tells somebody the thing they just did worked.

   And the file that DID load was not read. _devProjectContext gave the model
   16,000 characters, about 4,000 tokens, against a declared budget of 180,000
   tokens that the product draws the user a meter against. Worse than the size
   was the shape: each file was one chunk, and a chunk that did not fit was not
   shortened - the loop appended "[...truncated...]" and BROKE, so a file
   bigger than the budget contributed nothing at all and every file behind it
   was dropped too. Measured on the 544KB upload that had just been confirmed
   on screen: the model received 71 characters. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { writeFileSync, mkdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DIR = join(tmpdir(), 'amv-bigfiles-' + process.pid);
mkdirSync(DIR, { recursive: true });
const mk = (name, lines, width) => {
  const p = join(DIR, name);
  writeFileSync(p, Array.from({ length: lines },
    (_, i) => `function f${i}(a,b){ return a+b+${i}; }`.padEnd(width, ' ') + `// line ${i + 1}`).join('\n'));
  return { path: p, bytes: statSync(p).size };
};
const tenk = mk('tenk.js', 10000, 20);
const tenkWide = mk('tenk-wide.js', 10000, 90);
const overCeiling = join(DIR, 'huge.js');
writeFileSync(overCeiling, 'x'.repeat(6000000));
const fine = join(DIR, 'ok.js');
writeFileSync(fine, 'console.log(1)\n'.repeat(50));

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => { setTab('build'); setBuildMode('code'); });
await page.waitForTimeout(400);

/* Fresh project, and a toast recorder that replaces rather than wraps - a
   first draft wrapped the wrapper each round and reported the same message
   three times, which looked like the product shouting. */
const reset = () => page.evaluate(() => {
  _DEV.project = {}; _DEV.activePath = ''; _DEV.log = [];
  if (!window.__realToast) window.__realToast = window.toast;
  window.__toasts = [];
  window.toast = (m, k) => { window.__toasts.push((k || '') + ' | ' + m); return window.__realToast(m, k); };
});
const upload = async (paths) => {
  await reset();
  await page.setInputFiles('#dev-files', paths);
  await page.waitForTimeout(900);
  return page.evaluate(() => ({
    files: Object.keys(_DEV.project),
    chars: Object.values(_DEV.project).reduce((n, v) => n + ((v.content || '').length), 0),
    toasts: window.__toasts,
  }));
};

section('Ten thousand lines loads, whatever the lines look like');
{
  const a = await upload([tenk.path]);
  ok(a.files.length === 1, 'a 10,000-line file loads', a.files);
  ok(a.chars > 500000, 'with all of it kept, not a prefix', a.chars);

  /* The case that used to disappear. Same line count, wider lines, over the
     old ceiling - and the only difference somebody could see was nothing
     happening. */
  const b = await upload([tenkWide.path]);
  ok(b.files.length === 1, 'and so does the same 10,000 lines at 1MB', b.files);
  ok(b.chars > 1000000, 'also whole', b.chars);
}

section('A file too big to take says so, and is never called a success');
{
  const r = await upload([overCeiling]);
  ok(r.files.length === 0, 'a 6MB file is refused', r.files);
  const said = r.toasts.join(' ');
  ok(/error/.test(said), 'and it is an error, not a success', r.toasts);
  ok(/huge\.js/.test(said), 'naming the file, so it is obvious which one', r.toasts);
  ok(!/Loaded 0/.test(said), 'never "Loaded 0 files", which is a success message about nothing', r.toasts);
}

section('A mixed batch loads what it can and names what it did not');
{
  const r = await upload([fine, overCeiling]);
  ok(r.files.length === 1 && r.files[0] === 'ok.js', 'the good file is loaded', r.files);
  const said = r.toasts.join(' ');
  ok(/Loaded 1 file/.test(said), 'and says so', r.toasts);
  ok(/[Ss]kipped/.test(said) && /huge\.js/.test(said),
     'while naming the one it skipped, rather than quietly reporting success', r.toasts);
}

section('The model is actually given the file, which is the whole point');
{
  /* Loaded here rather than relying on an earlier section: the mixed batch
     above left a 50-line file in the project, and reading the context then
     measured that instead. A first run reported 821 characters and I nearly
     read it as the bug still being there. */
  await upload([tenk.path]);
  const seen = await page.evaluate(async () => {
    const ctx = _devProjectContext();
    return { len: ctx.length,
             /* Line 5,000 sits around 275KB in - seventeen times past the old
                16,000-character budget, and comfortably inside the new one.
                Not the last line: the file is 544KB against a budget of about
                396KB, so the tail is legitimately outside it and asserting on
                that would be demanding an infinite context. */
             deep: /function f5000\b/.test(ctx) };
  });
  /* 71 characters was the old answer for a file of this size. */
  ok(seen.len > 100000, 'a large file reaches the model as content, not as a list', seen.len);
  ok(seen.deep, 'and it is really the file, thousands of lines in', seen.deep);
}

section('The budget is the declared one, not two per cent of it');
{
  const derived = await page.evaluate(() => ({
    budget: Math.floor(CTX_LIMIT_TOKENS * 0.55) * 4,
    limit: CTX_LIMIT_TOKENS,
  }));
  ok(derived.budget > 300000,
     'the project may use a real share of the context the product advertises', derived);
  /* Derived from the constant rather than restated, so raising one cannot
     leave the other behind - which is how it came to be spending 2%. */
  const src = await page.evaluate(() => String(_devProjectContext).slice(0, 900));
  ok(/CTX_LIMIT_TOKENS/.test(src), 'and is computed from that constant, not a copy of it', true);
}

section('A file too big to carry whole gives its beginning, not nothing');
{
  const r = await page.evaluate(() => {
    _DEV.project = {};
    _devSetFile('big.js', 'a'.repeat(900000));
    const c = _devProjectContext();
    return { len: c.length, head: /aaaa/.test(c), tail: c.slice(-160) };
  });
  ok(r.head && r.len > 100000, 'the start of the file is included', r.len);
  ok(/more characters of this file not included/.test(r.tail),
     'and it says how much was left out instead of pretending that was all of it', r.tail.slice(-90));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-large-file-is-actually-read') > 0) process.exitCode = 1;
done();
