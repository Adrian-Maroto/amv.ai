/* THE TERMS DID NOT SAY HOW OLD YOU HAVE TO BE.

   The Privacy Policy had a position - "not directed to children under 13 (or
   the minimum age in your region)" - so the product stated an age in the
   document that explains data handling and stated none in the document that
   forms the agreement. Nothing collected an age either, which made the
   compliance module's gate the only place the question existed at all.

   Two documents and one enforced rule that all have to say the same thing, and
   the way they drift is that somebody edits one of them. So this reads all
   three and compares them, rather than checking that a sentence somebody liked
   is still present.

   The payment line is the one with teeth: a minor cannot enter a binding
   contract, which is the reason the compliance module gives for gating money
   at all, and it is what _moneyAgeGate enforces. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const openText = (fn) => page.evaluate(async (name) => {
  const o = document.getElementById('ovr'); o.innerHTML = ''; o.className = '';
  document.getElementById('ck')?.remove();
  window[name]();
  await new Promise(r => setTimeout(r, 350));
  return {
    text: o.innerText || '',
    heads: [...o.querySelectorAll('.ts h4')].map(h => h.textContent.trim()),
  };
}, fn);

section('The Terms state who may use AMV, and where the money line is');
{
  const t = await openText('openTerms');
  ok(/at least 13/i.test(t.text), 'a minimum age to use it at all', /at least 13/i.test(t.text));
  ok(/18 or older/i.test(t.text), 'and a higher one to pay for anything', /18 or older/i.test(t.text));
  ok(/binding contract/i.test(t.text),
     'saying why, which is the reason the product gates money on it', true);
  /* AMV supports a family manager paying for somebody under 18. Terms that
     ignored that would be terms the product breaks on its own feature. */
  ok(/family manager/i.test(t.text), 'and the case this product actually supports', true);

  /* Numbered sections, each number used once - a renumbering that doubles up
     is the ordinary way an edit here goes wrong. */
  const nums = t.heads.map(h => parseInt(h, 10)).filter(n => !isNaN(n));
  ok(nums.length >= 8, 'the Terms still have their sections', nums.length);
  ok(new Set(nums).size === nums.length, 'and no number is used twice', nums);
  ok(nums.every((n, i) => n === i + 1), 'and they run 1..n with no gap', nums);
}

section('And the Privacy Policy does not contradict them');
{
  /* The drift this is about: two documents with a number in each. */
  const p = await openText('openPrivacy');
  const t = await openText('openTerms');
  const ageIn = (s) => (String(s).match(/under (\d{2})|at least (\d{2})/g) || []);
  ok(/under 13/i.test(p.text), 'the Privacy Policy still names 13', ageIn(p.text));
  ok(/at least 13/i.test(t.text), 'and the Terms name the same 13', ageIn(t.text));
  ok(!/under 16\b/i.test(p.text) || /16/.test(t.text),
     'and if one of them mentions 16, so does the other', { p: ageIn(p.text), t: ageIn(t.text) });
}

section('The gate the server enforces is about the same thing');
{
  /* A promise in a document nothing enforces is the shape this repository
     keeps finding. The Terms say 18 to pay; the Worker has a gate for exactly
     that, and it is reachable from the money routes. */
  const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/_moneyAgeGate/.test(worker), 'the Worker has an age gate at all', true);
  const gated = ['browserRun', 'marketBuy', 'marketWithdraw', 'stripeCheckout', 'paypalSubscribe', 'marketPublish']
    .filter(fn => {
      const at = worker.indexOf('async function ' + fn);
      if (at < 0) return false;
      return /_moneyAgeGate/.test(worker.slice(at, at + 4000));
    });
  ok(gated.length >= 3, 'and more than one money route asks it', gated);
  /* Named, so that the set changing is a decision somebody made rather than
     something that happened. */
  ok(gated.includes('marketBuy') && gated.includes('marketWithdraw'),
     'including buying and taking money out', gated);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
