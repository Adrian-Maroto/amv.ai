/* MARKETPLACE MODERATION — illegal listings (drugs, weapons, malware, etc.)
   must be blocked server-side so they can't be bypassed from the client. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, '..', '..', 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'mktmod.harness.mjs');
writeFileSync(harness, src + '\nexport { _marketScreen };\n');
const W = await import(harness + '?t=' + Date.now());

section('Illegal drug listings are blocked (incl. cannabis + slang)');
const drugs = ['Cocaine plug','Weed for sale','Sell weed','Buy marijuana cheap','Adderall for sale','Xanax bars','8 ball molly','420 friendly top shelf bud'];
for (const title of drugs) {
  const r = W._marketScreen({ title, desc:'', text:'', cat:'Other' }, []);
  ok(!r.ok && r.action === 'blocked', `"${title}" is blocked`, r.action);
}

section('Other prohibited categories are blocked');
for (const [title] of [['Buy a ghost gun'],['ransomware builder'],['stolen credit card dump'],['fake passport for sale']]) {
  const r = W._marketScreen({ title, desc:'', text:'', cat:'Other' }, []);
  ok(!r.ok && r.action === 'blocked', `"${title}" is blocked`, r.action);
}

section('Legitimate listings are allowed');
for (const title of ['SEO Blog Writer','Excel Finance Model Pack','Study Plan Generator','Logo design prompt']) {
  const r = W._marketScreen({ title, desc:'a helpful tool', text:'legit content', cat:'Marketing' }, []);
  ok(r.ok, `"${title}" is allowed`, r.action);
}

report();
done();
