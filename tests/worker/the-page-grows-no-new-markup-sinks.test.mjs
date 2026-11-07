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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = readFileSync(join(ROOT, 'app.js'), 'utf8');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const count = (re) => (src.match(re) || []).length;

const CEILING = {
  'innerHTML assignments': [/\.innerHTML\s*\+?=(?!=)/g, 407],
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
