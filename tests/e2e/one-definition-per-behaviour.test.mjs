/* TWO COPIES MEANS ONE OF THEM IS ALREADY WRONG.

   Not eventually. Already - by the time anybody notices there are two, a fix
   has usually landed on one of them.

   That happened twice in a single day here. Three files each carried their own
   hand-rolled function-body extractor, and one of them silently mis-read an
   11800-character function as 1200. Two functions each carried their own copy
   of "send the message they typed before signing up", so a sabotage of one
   passed the tests while the other did the work - and the copy that would keep
   a future bug was the SIGN-UP path, which is new users, who are the only
   people that feature exists for.

   And the sharpest one: `_deployApi` was a byte-for-byte copy of `_autoApi`
   with a single difference. The other carried the error `code` and `status`
   through, with a comment explaining that a caller must be able to tell "this
   needs a paid plan" from "the network failed". This copy threw a bare Error,
   so every deploy failure arrived indistinguishable. The fix had been written,
   reasoned about in a comment, and applied to one of the two.

   So: a block of real code that appears in two different modules is a finding.
   Some duplication is honest - a registration shape every connector repeats,
   a two-line event wiring - and those are named below with the reason. What is
   not allowed is a new one appearing and nobody noticing. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'src/app');
const files = readdirSync(DIR).filter(f => /\.js$/.test(f)).sort();

/* Compare code, not spelling. Comments go, whitespace goes, and string
   CONTENTS collapse - so two copies that differ only by a label or a quote
   style still collide, which is what a copy usually looks like. */
const norm = (l) => l
  .replace(/\/\/.*$/, '')
  .replace(/\s+/g, '')
  .replace(/'[^']*'/g, "'S'")
  .replace(/"[^"]*"/g, "'S'");

const BLOCK = 4;          // lines
const MIN_CHARS = 110;    // shorter than this is a shape, not a behaviour

/* Duplication that is honest, each with the reason it is not a defect. */
const ALLOWED = [
  { why: 'every connector registers with the same literal shape - a shared factory would hide what each one declares',
    match: /AMVConnectors\.register/ },
  { why: 'copy-to-clipboard then confirm on the button: two lines of wiring, no logic to drift',
    match: /_copyText\(/ },
  { why: 'the same toast-on-failure wiring around two different actions',
    match: /toast\(e\.message/ },
];

const seen = new Map();
for (const f of files) {
  const lines = readFileSync(join(DIR, f), 'utf8').split('\n');
  for (let i = 0; i < lines.length - BLOCK; i++) {
    const raw = lines.slice(i, i + BLOCK).join('\n');
    const key = lines.slice(i, i + BLOCK).map(norm).join('|');
    if (key.replace(/\|/g, '').length < MIN_CHARS) continue;
    if (!/[(){}]/.test(key)) continue;                 // prose or data, not code
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ where: f + ':' + (i + 1), raw });
  }
}

const crossModule = [...seen.values()]
  .filter(w => new Set(w.map(x => x.where.split(':')[0])).size > 1);

section('Both halves of the codebase were actually read');
{
  ok(files.length > 20, 'every source module was scanned', files.length);
  ok(seen.size > 500, 'and a real number of code blocks compared', seen.size);
}

section('No behaviour is implemented twice in two different modules');
{
  const unexplained = crossModule.filter(w => !ALLOWED.some(a => a.match.test(w[0].raw)));
  ok(unexplained.length === 0,
     'nothing is defined in two places without a stated reason',
     unexplained.slice(0, 6).map(w => w.map(x => x.where).join('  <->  ')));
}

section('The allowances still describe something that exists');
{
  /* An allowance for duplication that is no longer there stops being a
     statement and starts being a hole the next copy can hide in. */
  const stale = ALLOWED.filter(a => !crossModule.some(w => a.match.test(w[0].raw)));
  ok(stale.length === 0, 'every stated allowance still matches real code', stale.map(a => a.why));
}

section('The three that caused real bugs are gone');
{
  /* Named directly. The general rule above would go quiet if somebody
     re-introduced one of these under a slightly different shape, and these are
     the three that actually cost something. */
  const all = files.map(f => readFileSync(join(DIR, f), 'utf8')).join('\n');

  const extractors = (all.match(/function\s+bodyOf\s*\(/g) || []).length;
  ok(extractors === 0, 'no module rolls its own function-body extractor', extractors);

  /* It appears ONCE, inside its own definition. Asserting zero was wrong: the
     helper has to read the pending value, and a check that forbids the one
     legitimate use is a check that will be edited away rather than obeyed. */
  const pending = (all.match(/const\s+pm\s*=\s*_pendingMessage/g) || []).length;
  ok(pending === 1, 'the pending-message send is written exactly once', pending);
  ok(/function _sendPendingMessage\(\)/.test(all), 'as a named function', true);
  ok(functionBody(all, '_sendPendingMessage').includes('_pendingMessage'),
     'and that one use is inside it, not inlined at a call site', true);

  /* The deploy helper delegates rather than repeating the request. */
  const deployOwnFetch = /_deployApi\([^)]*\)\s*\{[^}]*fetchDeadline/.test(all.replace(/\n/g, ' '));
  ok(!deployOwnFetch, 'deploy does not carry its own copy of the API request', deployOwnFetch);
}

if (report('one-definition-per-behaviour') > 0) process.exitCode = 1;
done();
