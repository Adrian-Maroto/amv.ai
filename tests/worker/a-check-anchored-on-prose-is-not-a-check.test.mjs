/* A CHECK THAT READS A COMMENT IS NOT CHECKING THE CODE.

   Most files in this directory assert something about the source: this guard is
   inside that handler, that route is bounded, this number is computed once. All
   of them do it by reading amv-backend.js or app.js as text - and text includes
   the comments, which in this codebase are long and describe exactly the thing
   being asserted. The better the explanation, the more likely it satisfies a
   grep looking for the thing it explains.

   That is not a theoretical hazard. Every one of these was live:

     - every-route-decides asked whether _adminGate refuses, by looking for the
       refusal status in it. It passed. The status in the code was 403; the only
       "401" in the function was the sentence explaining why it is NOT 401 any
       more. The check was green because of the paragraph written to explain the
       change it existed to notice.

     - model-economics located an 1800-character window with
       src.indexOf('AMV-068'). AMV-068 appears once, in a comment. Delete the
       comment and indexOf returns -1, so the window becomes the last character
       of the file and four assertions fail on code nobody touched. Move the
       comment and the window covers unrelated code while still passing.

     - token-allowance started a window at "Keyed by the billing subject so a
       team", and a-corrupt-record at "An unhandled exception reached the top
       level". Both sentences. Both windows relocate when somebody edits prose.

     - unit-economics required an exact comment, so rewording the note went red,
       and pasting those words beside a bare rethrow would have gone green.

   The test here is exact rather than a guess about what looks like a sentence:
   take the product source, blank every comment, and ask whether the anchor or
   the pattern still finds anything. Something that matches the real file and
   not the comment-free one is matching a comment - whatever it looks like.

   That also keeps the honest cases honest. A great many checks assert on words
   because the words are the product: the copy in a family invite, the refusal a
   widget shows, the text of an alert. Those live in string literals, which are
   code, so they still match and nothing is reported. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SELF = 'a-check-anchored-on-prose-is-not-a-check.test.mjs';

/* The two files the checks read. */
const SOURCES = ['amv-backend.js', 'app.js'].map(f => {
  const raw = readFileSync(join(ROOT, f), 'utf8');
  return { file: f, raw, code: codeOnly(raw) };
});

const files = [];
for (const dir of ['worker', 'e2e']) {
  let names = [];
  try { names = readdirSync(join(ROOT, 'tests', dir)); } catch { /* no such dir */ }
  for (const n of names) {
    if (!n.endsWith('.test.mjs') || n === SELF) continue;
    files.push({ name: dir + '/' + n, text: readFileSync(join(ROOT, 'tests', dir, n), 'utf8') });
  }
}

/* True when this text is found in the product ONLY because of a comment.

   Asked across BOTH files together, not one at a time. A phrase can be real UI
   copy in app.js and also appear in a note in amv-backend.js explaining it -
   "nothing is stored on a server" is exactly that - and per-file the Worker
   answers "only in prose" while the string the user actually reads sits in the
   other file. Found in code anywhere means found in code. */
const onlyInProse = (needle) =>
  SOURCES.some(s => s.raw.includes(needle)) && !SOURCES.some(s => s.code.includes(needle));

/* The same question for a pattern. Built with a fresh RegExp so a /g flag on
   the original cannot carry lastIndex between the two calls. */
const patternOnlyInProse = (pat, flags) => {
  let re;
  try { re = new RegExp(pat, flags.replace(/[gy]/g, '')); } catch { return false; }
  const hit = (t) => { re.lastIndex = 0; return re.test(t); };
  return SOURCES.some(s => hit(s.raw)) && !SOURCES.some(s => hit(s.code));
};

/* Deliberate: these assert that a decision is DOCUMENTED, which is a real thing
   to want and can only be checked by reading the prose. Naming them keeps
   "reads a comment on purpose" separate from "reads a comment by accident",
   instead of it being a judgement call every time somebody looks. */
const DOCUMENTED_ON_PURPOSE = {
  'worker/token-allowance.test.mjs':
    'the tokenizer ratio must carry a note to re-measure rather than guess, and the token caps must say in words that they are the secondary guard',
};

section('Every test file was read, and both product sources with them');
{
  ok(files.length > 100, 'the suites are all here to be checked', files.length);
  ok(files.some(f => /\.indexOf\(/.test(f.text)),
     'and they really do locate windows into the source this way', true);
  SOURCES.forEach(s => {
    ok(s.code.length === s.raw.length && s.code !== s.raw,
       s.file + ': a comment-free copy exists to compare against', s.file);
  });
}

section('No window into the source is located by a sentence');
{
  const bad = [];
  for (const f of files) {
    const code = codeOnly(f.text);           // the test's OWN comments do not count
    for (const m of code.matchAll(/\.indexOf\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      if (onlyInProse(m[2])) bad.push(f.name + ': ' + JSON.stringify(m[2].slice(0, 60)));
    }
  }
  ok(bad.length === 0,
     'a window is anchored on code, so editing a comment cannot move it', bad);
}

/* Which local variables in a test file hold PRODUCT SOURCE.

   This matters because most regexes in these files are matched against page
   text, a chat reply, a wrangler.toml or a fixture, and whether their words
   also appear in a comment somewhere in app.js is nobody's business. Asking
   the question of every regex produced a hundred findings and one real one.

   So the variables are traced instead: a name bound to readFileSync of a
   product file, or to functionBody/codeOnly/slice/match of a name already
   known to hold source. Repeated until it stops growing, because these files
   narrow a window in two or three steps. */
function sourceVars(text) {
  const known = new Set();
  const PRODUCT = /readFileSync\([^)]*['"](?:amv-backend\.js|app\.js)['"]/;
  for (let pass = 0; pass < 4; pass++) {
    const before = known.size;
    for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
      const [, name, rhs] = m;
      if (PRODUCT.test(rhs) ||
          /\b(?:functionBody|functionSource|codeOnly)\s*\(/.test(rhs) ||
          [...known].some(k => new RegExp('\\b' + k + '\\s*\\.(?:slice|substring|replace|match|split)\\b').test(rhs)) ||
          [...known].some(k => new RegExp('\\b(?:functionBody|functionSource|codeOnly)\\s*\\(\\s*' + k + '\\b').test(rhs))) {
        known.add(name);
      }
    }
    if (known.size === before) break;
  }
  return known;
}

section('And no assertion about the source passes on prose alone');
{
  const bad = [];
  let examined = 0;
  for (const f of files) {
    if (f.name in DOCUMENTED_ON_PURPOSE) continue;
    const code = codeOnly(f.text);           // the test's OWN comments do not count
    const vars = sourceVars(code);
    if (!vars.size) continue;
    const names = [...vars].join('|');
    /* Positive matches only. `!/x/.test(src)` asserting something is ABSENT is
       not weakened by a comment - removing comments can only make it more
       true - so a negated pattern is not this file's business. */
    const uses = new RegExp(
      '(!?)\\/((?:\\\\.|\\[(?:\\\\.|[^\\]\\\\])*\\]|[^/\\\\\\n[])+)\\/([dgimsuvy]*)\\s*\\.(?:test|exec)\\(\\s*(?:' + names + ')\\b', 'g');
    for (const m of code.matchAll(uses)) {
      examined++;
      if (m[1] === '!') continue;
      if (patternOnlyInProse(m[2], m[3])) bad.push(f.name + ': /' + m[2].slice(0, 60) + '/');
    }
    const matches = new RegExp('(?:' + names + ')\\s*\\.match\\(\\s*\\/((?:\\\\.|\\[(?:\\\\.|[^\\]\\\\])*\\]|[^/\\\\\\n[])+)\\/([dgimsuvy]*)', 'g');
    for (const m of code.matchAll(matches)) {
      examined++;
      if (patternOnlyInProse(m[1], m[2])) bad.push(f.name + ': /' + m[1].slice(0, 60) + '/');
    }
  }
  /* If the tracing broke, this would find nothing and report success. */
  ok(examined > 100, 'assertions against the product source were found to check', examined);
  ok(bad.length === 0,
     'an assertion about code is written against code, not against its explanation', bad);
}

section('The deliberate exceptions still describe something real');
{
  const names = new Set(files.map(f => f.name));
  const gone = Object.keys(DOCUMENTED_ON_PURPOSE).filter(n => !names.has(n));
  ok(gone.length === 0, 'every named exception is still a file that exists', gone);
  /* And it is still doing what it is excused for. An exemption for a file that
     no longer reads any prose is an exemption nobody will notice went stale. */
  for (const n of Object.keys(DOCUMENTED_ON_PURPOSE)) {
    const f = files.find(x => x.name === n);
    if (!f) continue;
    const code = codeOnly(f.text);
    const still = [...code.matchAll(/\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/g)]
      .some(m => patternOnlyInProse(m[1], m[2]));
    ok(still, n + ' still reads the documentation it is excused for reading', n);
  }
}

section('The comment stripper itself is sound, because everything above trusts it');
{
  /* If codeOnly were wrong it would be wrong in the direction of passing: a
     scan that loses its place treats MORE of the file as string, which leaves
     comments in, which makes a prose-dependent check look code-dependent. */
  for (const s of SOURCES) {
    ok(s.raw.split('\n').length === s.code.split('\n').length,
       s.file + ': line numbers still line up with the file', s.file);
    ok(s.code.length === s.raw.length,
       s.file + ': nothing shifted - comments are blanked, not deleted', s.file);
    /* A whole file scanned correctly ends outside every literal. The last
       backtick count is the cheap proof: an odd number means the scanner
       finished believing it was inside a template. */
    ok((s.code.match(/`/g) || []).length % 2 === 0,
       s.file + ': the scan ends outside every template literal',
       (s.code.match(/`/g) || []).length);
  }
  /* The specific shapes that made earlier versions wrong. Each one, gotten
     wrong, silently disables every check on this page. */
  const tricky = [
    ['a regex holding quotes',        "const a = /['\"]/g; /* gone */ const keep = 1;"],
    ['a regex holding slashes',       'const b = /https?:\\/\\//; /* gone */ const keep = 2;'],
    ['a URL in a string',             'const c = "http://x/y"; /* gone */ const keep = 3;'],
    ['division, which is not a regex', 'const d = a / b; /* gone */ const keep = 4;'],
    ['a slash inside a class',        'const e = /[/]/; // gone\nconst keep = 5;'],
    ['a nested template',             'const f = `a${x ? `y` : `z`}b`; /* gone */ const keep = 6;'],
    ['a comment inside ${ }',         'const g = `a${/* gone */ x}b`; const keep = 7;'],
    ['a template inside a template inside a template',
                                      'const h = `${`${`${q}`}`}`; /* gone */ const keep = 8;'],
    ['an apostrophe in template text', 'const i = `it’s /* not a comment */ fine`; /* gone */ const keep = 9;'],
  ];
  tricky.forEach(([what, code]) => {
    const c = codeOnly(code);
    ok(c.includes('keep') && !/gone/.test(c) && c.length === code.length,
       what + ' is handled', c);
  });
}

if (report('a-check-anchored-on-prose-is-not-a-check') > 0) process.exitCode = 1;
done();
