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
  /* 406 (Nov 24): DOWN three - Handoff's screen moved out of the page into
     handoff-view.js (counted with the fetched files below, which rose by the
     same three). */
  'innerHTML assignments': [/\.innerHTML\s*\+?=(?!=)/g, 406],
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
  /* Not the page's own code file (app.<hash>.js): it is app.js minified,
     counted above already. */
  const files = readdirSync(dir).filter(f => f.endsWith('.js') && !/^app\.[a-f0-9]{12}\.js$/.test(f)).sort();
  const all = files.map(f => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n');
  const n = (re) => (all.match(re) || []).length;
  ok(files.length >= 25, 'there are files to read - an empty folder would pass everything below', files.length);
  const LAZY = { 'innerHTML assignments': [CEILING['innerHTML assignments'][0], 223], 'insertAdjacentHTML calls': [CEILING['insertAdjacentHTML calls'][0], 2], 'outerHTML assignments': [CEILING['outerHTML assignments'][0], 3] };
  /* innerHTML 223 (Nov 24): three, the code workspace's Problems and Next
     steps (code-view.js) - the empty state, the problem list and the
     suggestions. Every value through escH: fixed sentences through T(), each
     problem's text (relayed from the sandboxed preview as a string, never
     markup) and each suggestion the engine returned.
     innerHTML 220 (Nov 24): one, the notification list (notifications.js) -
     one panel.innerHTML whose every value goes through escH: the kind's own
     fixed sentence through T(), and the result snippet, the sender's address,
     the handoff's title and the security event's label, each escaped.
     innerHTML 219 (Nov 24): three, moved here from the page with Handoff's
     screen (the page's ceiling fell by the same three). Two were already
     there - the screen and the "Pull in your work" picker, every value
     through escH - and one is new: the attached-work card (_hoShowPulled),
     drawn by _hoWorkCardHTML from escH(T()) and escH of the work's title.
     innerHTML 216 (Nov 21, Build 16 audit D16-02 and D16-08): four. The
     receipts list's loading, empty and could-not-load states (spending.js),
     each one fixed sentence through escH(T()); and Settings → Connectors'
     line where the accounts would be (settings-panes.js): an empty <p>, then
     _connNoneHTML(), whose every part is escH(T()) or escH of the server's
     error text. The receipts table itself was rewritten, not added; each of
     its cells is through escH.
     innerHTML 212 (Nov 17): Integrations' loading state while its order
     arrives (integrations-view.js) - a heading and two fixed sentences, each
     through escH(T()), and empty loading blocks; nothing from outside.
     innerHTML 211 (Nov 17): seven, every value through escH - Crew's Running
     now panel (two repaints of _crewNowHTML), the Crew conversation (its
     dialog shell, each message, the repaint after a job is made), and the
     cross-country service search (three states of one box) and the topic
     rows it fills on Integrations (three). Read line by line; the one value
     that was not escaped (a service kind from the country files) is now.
     */
  /* innerHTML 204 (Nov 16): the refund card in Billing (settings-panes.js,
     two), the owner's Refunds tab (admin.js, three - the rows through escH,
     the rest fixed text) and the purchase receipts in Spending (spending.js,
     every cell through escH). */
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
