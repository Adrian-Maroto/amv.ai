/* AN AVATAR IS ITS PERSON (Nov 28).

   Without a photo every avatar was the same "A": the account menu said
   "Sam Rivera" beside an A, and a page of marketplace reviewers was a row of
   identical As. Now it is the person's initial - their name when it is known,
   else their address - and "A" only for AMV itself or nobody in particular. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Sam Rivera', email: 'sam@example.com', ini: 'S' } });
const { page, errors } = app;
const letter = (sel) => page.evaluate((s) => { const t = document.querySelector(s + ' svg text'); return t ? t.textContent : null; }, sel);

section('The signed-in person');
{
  await page.waitForTimeout(500);
  ok(await letter('#nav-av') === 'S', 'the header avatar is S for Sam Rivera', await letter('#nav-av'));
  const r = await page.evaluate(() => ({
    named: _avatarLetter('sam@example.com'),
    other: _avatarLetter('zoe@example.com'),
    byName: _avatarLetter('x@example.com', 'Élodie'),
    amv: _avatarLetter('amv'),
    none: _avatarLetter(''),
    script: _avatarLetter('', '<b>'),
  }));
  ok(r.named === 'S' && r.other === 'Z' && r.byName === 'É', 'anyone else: their name when known, else their address', r);
  ok(r.amv === 'A' && r.none === 'A' && r.script === 'B', 'AMV and nobody stay A; markup is never a letter', r);
}

section('Two different people look different');
{
  const r = await page.evaluate(() => [_avatarHTML('ana@example.com', 28), _avatarHTML('ben@example.com', 28)]
    .map(h => { const d = document.createElement('div'); d.innerHTML = h; return d.querySelector('text').textContent; }));
  ok(r[0] === 'A' && r[1] === 'B', 'Ana is A and Ben is B, not both A', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
