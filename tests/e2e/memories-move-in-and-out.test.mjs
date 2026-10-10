/* MEMORIES MOVE IN AND OUT.

   The Memory screen exports its own file and imports one, or a list pasted
   from another assistant. Driven through the real screen on a phone:

   - a pasted list (bullets, numbers, a heading) becomes one memory a line;
   - nothing is added until the person has seen each one, and an unticked
     one stays out;
   - a duplicate of something already known, and anything that looks like a
     password or card number, are left out and counted - never added;
   - AMV's own export comes back in whole, and the whole-account export's
     memories are read too;
   - the 200-memory limit holds. */
import { readFileSync } from 'fs';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors } = app;

await page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  S.memory = [{ id: 'm1', text: 'I prefer short answers', added: Date.now() }];
  setTab('memory');
});
await page.waitForSelector('#mem-imp-open');

const PASTE = `Saved memories:
- Lives in Madrid and works as a nurse
- prefers short answers
1. Is studying for the MIR exam
• My password is hunter2
* Has a dog called Lola
# Notes
[x] Card 4111 1111 1111 1111
Speaks Spanish and English`;

section('A pasted list is shown, one memory a line, before anything is added');
{
  await page.click('#mem-imp-open');
  await page.fill('#mem-imp-txt', PASTE);
  await page.click('#mem-imp-review');
  const r = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#mem-imp-list .memio-row span')].map(s => s.textContent),
    say: document.querySelector('#mem-imp-list .memio-say').textContent,
    count: S.memory.length,
  }));
  ok(r.rows.join('|') === 'Lives in Madrid and works as a nurse|Is studying for the MIR exam|Has a dog called Lola|Speaks Spanish and English',
     'bullets, numbers and boxes taken off; the heading skipped', r.rows);
  ok(/1 already known/.test(r.say) && /2 left out because they look like a password, key or card number/.test(r.say),
     'the duplicate and the two secrets are counted, not added', r.say);
  ok(r.count === 1, 'and nothing has been added yet', r.count);
}

section('Only the ticked ones go in');
{
  await page.click('[data-memimp="2"]');   // untick the dog
  const label = await page.textContent('#mem-imp-add');
  ok(/Add 3 memories/.test(label), 'the button follows the ticks', label);
  await page.click('#mem-imp-add');
  const mem = await page.evaluate(() => S.memory.map(m => m.text));
  ok(mem.length === 4 && mem.includes('Is studying for the MIR exam') && !mem.includes('Has a dog called Lola'),
     'three added, the unticked one left out', mem);
  ok(!mem.some(t => /hunter2|4111/.test(t)), 'and no secret is in memory', mem);
  ok(await page.evaluate(() => document.querySelectorAll('#mem-list .memc').length === 4), 'the list on screen shows them');
}

section('AMV’s own export comes back whole; the account export is read too');
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mem-exp')]);
  const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  ok(file.format === 'amv-memories' && file.items.length === 4, 'the export holds every memory', file.items.length);
  const r = await page.evaluate((file) => {
    S.memory = [];
    const a = _memImportPlan(_memParse(JSON.stringify(file))).add.length;
    const b = _memParse(JSON.stringify({ memories: [{ id: 'x', text: 'Works nights' }], convs: [] }));
    return { a, b };
  }, file);
  ok(r.a === 4, 'importing the export into an empty memory adds all four', r.a);
  ok(r.b.length === 1 && r.b[0] === 'Works nights', 'and the whole-account export’s memories are found', r.b);
}

section('The limit holds');
{
  const r = await page.evaluate(() => {
    S.memory = Array.from({ length: 198 }, (_, i) => ({ id: 'k' + i, text: 'Existing fact number ' + i + ' about topic ' + i, added: 1 }));
    return _memImportPlan(['Likes jazz music a lot', 'Runs marathons every spring', 'Drives an electric bicycle']);
  });
  ok(r.add.length === 2 && r.over === 1, 'only two fit under 200, and the third is counted as over', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('memories-move-in-and-out') > 0) process.exitCode = 1;
done();
