/* EVERY REFUND PROMISE MATCHES THE POLICY THE SERVER RUNS.

   The landing page carried a "30-day money-back guarantee" badge while the
   server's policy (68-refunds.js) is fourteen days, on light use, once a
   year. Nothing tied the sentence to the numbers, so the page made a promise
   about money that the product does not keep - the kind somebody holds a
   company to.

   So the numbers are read from the Worker's source, and every page and
   answer a visitor reads is checked against them: no unconditional
   "money-back guarantee" anywhere (the policy has conditions), and any
   refund window stated in days is the server's. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const policy = read('src/worker/68-refunds.js');
const DAYS = Number((policy.match(/const REFUND_DAYS\s*=\s*(\d+)/) || [])[1]);
const LIGHT = Number((policy.match(/const REFUND_LIGHT_USE\s*=\s*([\d.]+)/) || [])[1]);
ok(DAYS > 0 && LIGHT > 0 && LIGHT < 1, 'the refund window and light-use share are read from the Worker', { DAYS, LIGHT });

/* What a visitor reads: the page shell (landing, pricing), the app's own
   sources and the Help center's answers. Comments are stripped so a note
   ABOUT the old badge is not mistaken for the badge. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const files = ['index.html', 'src/help/faqs.js']
  .concat(readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).map(f => 'src/app/' + f));

section('No unconditional money-back promise');
{
  const hits = [];
  for (const f of files) {
    const t = strip(read(f));
    for (const m of t.matchAll(/money[- ]back\s+guarantee|full refund,? no questions asked|no[- ]questions[- ]asked refund/gi)) {
      hits.push(f + ': ' + t.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' '));
    }
  }
  ok(hits.length === 0, 'nothing promises a money-back guarantee - the policy has conditions', hits);
}

section('Every refund window stated in days is the server\'s');
{
  const wrong = [];
  let seen = 0;
  const pats = [
    /(\d+)[- ]day(?:s)?\s+(?:money|refund|guarantee)/gi,
    /refund[^.<]{0,60}?within\s+(\d+)\s+days/gi,
    /within\s+(\d+)\s+days\s+of\s+(?:a|your)\s+(?:plan\s+)?(?:charge|payment|purchase)/gi,
  ];
  for (const f of files) {
    const t = strip(read(f));
    for (const re of pats) for (const m of t.matchAll(re)) {
      seen++;
      if (Number(m[1]) !== DAYS) wrong.push(f + ': ' + m[0].replace(/\s+/g, ' '));
    }
  }
  ok(seen > 0, 'at least one refund window is stated, so this check is reading real copy', seen);
  ok(wrong.length === 0, 'and each one says ' + DAYS + ' days', wrong);
}

section('The Help center states the policy as the server runs it');
{
  const faqs = read('src/help/faqs.js');
  const a = (faqs.match(/q:'Can I get a refund\?', a:'([^']*(?:\\'[^']*)*)'/) || [])[1] || '';
  ok(a.includes(DAYS + ' days'), 'the refund answer names the ' + DAYS + '-day window', a.slice(0, 80));
  ok(a.includes(Math.round(LIGHT * 100) + '%'), 'and the ' + Math.round(LIGHT * 100) + '% light-use condition', a.slice(0, 120));
}

report();
done();
