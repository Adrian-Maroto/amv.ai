/* A BACKGROUND JOB THAT SAYS IT DID WHAT NO JOB CAN DO IS FLAGGED AT THE TOP.

   The runner can search and write; it cannot send, buy, book, pay, post or
   submit. Its instructions say so, and instructions are not a guarantee. So
   a result whose text claims a completed action - "I've sent the email to
   Maria" - gets a plain warning at the top, and the draft below it is kept.

   Driven through _autoExecute with the model's answer stood in for, so the
   check is proved to sit on the path every result takes - not only to exist.
   And the things it must NOT flag are checked as hard as the things it must:
   a warning on every honest result is a warning nobody reads. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'claimcheck.harness.mjs');
writeFileSync(harness, src + '\nexport { _autoExecute };\n');
const W = await import(harness + '?t=' + Date.now());

const env = { AMV_MODEL_KEY: 'k' };
async function run(answer) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: answer }], usage: {} }) });
  try { return (await W._autoExecute(env, { kind: 'task', detail: 'reply to Maria' }, {}, 'p@x.com')).text; }
  finally { globalThis.fetch = real; }
}
const flagged = (t) => /^\*\*Check this before relying on it\.\*\*/.test(t);

section('A claimed action is flagged at the top, and the draft is kept');
{
  const claims = [
    "I've sent the email to Maria confirming Thursday.",
    'I have booked a table for two at 8pm.',
    'I went ahead and paid the invoice.',
    'AMV submitted your application to the three roles.',
    'I just placed the order for the printer ink.',
    'I applied to all five jobs on InfoJobs.',
    'He enviado el correo a María.',
    'Ya reservé la mesa para el sábado.',
  ];
  for (const c of claims) {
    const out = await run('Here is the update.\n\n' + c + '\n\nAnything else?');
    ok(flagged(out) && out.includes(c), 'flagged: ' + c, out.slice(0, 140));
  }
  const out = await run("I've sent the email to Maria.");
  ok(/It says "I've sent"/.test(out) && /nothing was done/.test(out), 'the warning quotes what it claimed and says nothing happened', out.slice(0, 200));
}

section('Honest results are left exactly as they are');
{
  const honest = [
    'Ready to send - this has NOT been sent:\n\nHi Maria, Thursday works for me.',
    'I have not sent anything. Here is the draft.',
    'Your Amazon order has been shipped and arrives Friday.',
    '> I\'ve sent the contract, please sign it.\n\nJohn says the contract is in your inbox.',
    'John wrote: "I\'ve sent you the invoice" - it is attached to his email.',
    'I ordered the list by price, cheapest first.',
    'I applied a 10% discount to the estimate.',
    'Prices for flights to Lisbon this week: from 49 EUR.',
    'He revisado tu bandeja de entrada: tres correos nuevos.',
  ];
  for (const h of honest) {
    const out = await run(h);
    ok(out === h, 'untouched: ' + h.split('\n')[0].slice(0, 60), out.slice(0, 120));
  }
}

if (report('a-job-that-says-it-did-what-it-cannot') > 0) process.exitCode = 1;
done();
