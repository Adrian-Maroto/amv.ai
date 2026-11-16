/* THE PAGE GROWS NO NEW MARKUP SINKS WITHOUT SOMEBODY SAYING SO
   (Nov 3 audit SEC-003).

   Every `innerHTML =` is a place where a missed escape draws markup. The fuzz
   in tests/e2e/a-name-is-never-markup-on-any-screen proves the ones on every
   screen escape what they are given today; this holds the NUMBER of them, so
   a new one is a decision somebody made - raising a ceiling in this file, in
   the same diff, where review sees it - rather than a line that slipped in.
   The ceilings are today's counts and only go down.

   The APIs that turn a string into running code are not ratcheted - they are
   absent, and stay absent: eval, new Function, a timer given a string,
   createContextualFragment (which, unlike innerHTML, runs the scripts it
   parses). And no frame on this page may hold allow-same-origin: every frame
   that draws somebody else's markup does it in an opaque origin.

   Read from app.js with comments stripped, so a comment that names a sink is
   not counted as one. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = readFileSync(join(ROOT, 'app.js'), 'utf8');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const count = (re) => (src.match(re) || []).length;

const CEILING = {
  /* 408 (Nov 10): Spending's four cards are redrawn from _spvMoneyFacts, every
     value through escH. */
  /* 409 (Nov 15): openBankLink (22-finance.js) draws the bank dialog's frame
     - fixed markup and T() strings through escH, nothing from a person. */
  'innerHTML assignments': [/\.innerHTML\s*\+?=(?!=)/g, 409],
  'insertAdjacentHTML calls': [/insertAdjacentHTML\s*\(/g, 11],
  'outerHTML assignments': [/\.outerHTML\s*=(?!=)/g, 7],
  'document.write (the checkout window’s own placeholder)': [/document\.write(ln)?\s*\(/g, 1],
  'srcdoc assignments (both into sandboxed, opaque frames)': [/\.srcdoc\s*=/g, 2],
};
const ABSENT = {
  'eval(': /(^|[^\w.$])eval\s*\(/g,
  'new Function(': /new\s+Function\s*\(/g,
  'a timer given a string': /set(Timeout|Interval)\s*\(\s*['"`]/g,
  'createContextualFragment': /createContextualFragment\s*\(/g,
};

section('Markup sinks are held at today’s count');
for (const [name, [re, max]] of Object.entries(CEILING)) {
  const n = count(re);
  ok(n <= max, `${name}: ${n}, ceiling ${max}`, n > max ? 'a new sink: escape what it draws, then raise the ceiling here in the same change' : n);
}

section('The APIs that turn a string into running code are not used at all');
for (const [name, re] of Object.entries(ABSENT)) {
  const n = count(re);
  ok(n === 0, `${name}: none`, n);
}

section('The files fetched on demand are held to the same account');
{
  /* Everything above reads app.js. Thirty-odd screens have since left the
     page for files of their own under public/ (Crew, Tasks, Settings, the
     country catalogue), and a sink added there was counted by nothing - found
     on Nov 14 when the catalogue added three and this file stayed green.
     One total across those files, at today's count, and the same APIs absent. */
  const dir = join(ROOT, 'public');
  const files = readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  const all = files.map(f => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n');
  const n = (re) => (all.match(re) || []).length;
  ok(files.length >= 25, 'there are files to read - an empty folder would pass everything below', files.length);
  const LAZY = { 'innerHTML assignments': [CEILING['innerHTML assignments'][0], 198], 'insertAdjacentHTML calls': [CEILING['insertAdjacentHTML calls'][0], 2], 'outerHTML assignments': [CEILING['outerHTML assignments'][0], 3] };
  /* outerHTML 3 (Nov 15): crew-view.js redraws the country button in place
     (_cjRepaint) from _cjCountryBtnHTML - a flag from a fixed table and the
     country's name through escH. */
  for (const [name, [re, max]] of Object.entries(LAZY)) {
    const c = n(re);
    ok(c <= max, `fetched files, ${name}: ${c}, ceiling ${max}`, c > max ? 'a new sink: escape what it draws, then raise the ceiling here in the same change' : c);
  }
  for (const [name, re] of Object.entries(ABSENT)) ok(n(re) === 0, `fetched files, ${name}: none`, n(re));
  ok(n(/document\.write(ln)?\s*\(/g) === 0 && n(/\.srcdoc\s*=/g) === 0, 'and none writes a document or fills a frame from a string');
  ok(n(/allow-same-origin/g) === 0, 'nor gives a frame the page’s own origin');
}

section('No frame on this page is given the page’s own origin');
{
  const strs = src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*allow-same-origin(?:(?!\1)[^\\\n]|\\.)*\1/g) || [];
  ok(strs.length === 0, 'allow-same-origin appears in no string the page builds', strs.slice(0, 3));
}

section('The ratchet itself notices');
{
  const grown = src + '\nx.innerHTML = y;';
  const n = (grown.match(CEILING['innerHTML assignments'][0]) || []).length;
  ok(n === count(CEILING['innerHTML assignments'][0]) + 1, 'one more sink is counted as one more');
  ok(((src + '\n/* el.innerHTML = z */').replace(/\/\*[\s\S]*?\*\//g, '').match(CEILING['innerHTML assignments'][0]) || []).length === count(CEILING['innerHTML assignments'][0]), 'and a sink named in a comment is not');
}

report();
done();
