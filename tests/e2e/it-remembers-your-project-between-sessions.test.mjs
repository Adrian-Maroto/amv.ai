/* A PROJECT AMV ALREADY KNOWS WHEN YOU COME BACK TO IT.

   Every session used to start from nothing: AMV worked out how to run the
   tests, then threw it away, so the next request paid to rediscover the same
   fact. On a real repository that is minutes and rounds of somebody's
   allowance for something that has not changed since yesterday.

   The whole feature rests on one distinction, so that is what this checks
   hardest: a memory is only worth putting in a prompt if everything in it
   ACTUALLY HAPPENED. A command that ran and exited zero is evidence. A
   command the model asserted would work is not, and a command that FAILED is
   worse than nothing - recording it teaches the next turn to repeat a
   mistake.

   And because it goes into a prompt, it has to be visible and correctable.
   Something AMV believes about your project that you cannot see and cannot
   remove is how a helpful memory becomes a confidently wrong one. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const A = await bootApp({ tab: 'chat' });
const { page } = A;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  setTab('dev');
});
await page.waitForSelector('#dev-msg', { timeout: 8000 });

/* No real bridge here: this file is about the memory, not the daemon, and
   what identifies a project is the folder path. Set the two fields that
   identity is derived from. */
const connect = (root, folder) => page.evaluate(([r, f]) => {
  BRIDGE.connected = true; BRIDGE.root = r; BRIDGE.folder = f;
  _devRenderProject();
}, [root, folder]);

section('With no folder connected there is no project, and no pretending');
{
  const r = await page.evaluate(() => ({ id: projectId(), block: projBlock(), panel: projPanelHTML() }));
  ok(r.id === '', 'nothing identifies a project', JSON.stringify(r.id));
  ok(r.block === '', 'so nothing is added to the prompt', JSON.stringify(r.block));
  ok(r.panel === '', 'and no panel is drawn over nothing', JSON.stringify(r.panel));
  const learned = await page.evaluate(() => projLearn('this should go nowhere', 'test'));
  ok(learned === false, 'and a fact with nowhere to live is refused', learned);
}

section('A connected folder is a project, keyed without its path');
{
  await connect('/home/adrian/code/my-app', 'my-app');
  const r = await page.evaluate(() => ({ id: projectId(), name: projectName() }));
  ok(r.id.length > 3, 'it has a stable id', r.id);
  ok(r.name === 'my-app', 'and the readable name is the folder', r.name);

  /* THE PRIVACY POINT. This record syncs, and a folder path is almost always
     somebody's home directory with their real name in it. */
  ok(!/adrian|home|code/.test(r.id), 'the id carries no part of the path', r.id);

  const same = await page.evaluate(() => {
    const a = _projHash('/home/adrian/code/my-app');
    const b = _projHash('/home/adrian/code/my-app');
    const c = _projHash('/home/adrian/code/other-app');
    return { stable: a === b, distinct: a !== c };
  });
  ok(same.stable === true, 'the same folder gives the same id every time', same.stable);
  ok(same.distinct === true, 'and two folders do not collide', same.distinct);
}

section('It learns from what really ran, and only from that');
{
  const n = await page.evaluate(() => projLearnFromSteps([
    { name: 'run_command', ok: true,  input: { command: 'npm test' } },
    { name: 'run_command', ok: true,  input: { command: 'node build.mjs' } },
    /* Failed: says nothing about how this project works, and recording it
       would teach the next turn to repeat somebody's mistake. */
    { name: 'run_command', ok: false, input: { command: 'yarn test' } },
    /* True of every project on earth, so not a fact about this one. */
    { name: 'run_command', ok: true,  input: { command: 'ls -la' } },
    { name: 'run_command', ok: true,  input: { command: 'cat package.json' } },
    /* Not a command that ran at all. */
    { name: 'write_file',  ok: true,  input: { path: 'a.js', content: 'x' } },
  ]));
  ok(n === 2, 'two facts learned from six steps', n);

  const facts = await page.evaluate(() => PROJ.list.find(p => p.id === projectId()).facts.map(f => f.t));
  ok(facts.some(f => /npm test/.test(f)), 'the test command is remembered', facts);
  ok(facts.some(f => /node build\.mjs/.test(f)), 'and the build command', facts);
  ok(!facts.some(f => /yarn test/.test(f)),
     'the command that FAILED is not remembered as how this project works', facts);
  ok(!facts.some(f => /ls -la|cat package/.test(f)),
     'and looking around is not a fact about the project', facts);
}

section('Repetition counts for something, and duplicates do not pile up');
{
  const before = await page.evaluate(() => PROJ.list.find(p => p.id === projectId()).facts.length);
  await page.evaluate(() => projLearnFromSteps([
    { name: 'run_command', ok: true, input: { command: 'npm test' } },
    { name: 'run_command', ok: true, input: { command: 'npm  test' } },   // same, spaced differently
  ]));
  const after = await page.evaluate(() => {
    const p = PROJ.list.find(x => x.id === projectId());
    return { n: p.facts.length, seen: p.facts.find(f => /npm test/.test(f.t)).seen };
  });
  ok(after.n === before, 'saying it again does not add a second copy', { before, after: after.n });
  ok(after.seen >= 3, 'it is counted, so the best-established facts survive trimming', after.seen);
}

section('What it knows goes into the next turn, in its own words');
{
  const block = await page.evaluate(() => projBlock());
  ok(/WHAT YOU ALREADY KNOW/.test(block), 'the prompt carries a block about this project', true);
  ok(/my-app/.test(block), 'naming it', /my-app/.test(block));
  ok(/npm test/.test(block), 'with what was learned', /npm test/.test(block));
  ok(/not guesses/.test(block),
     'and says these are things that happened, so the model weighs them properly', true);
  ok(/go by what you find/.test(block),
     'while telling it to believe the folder over the memory when they disagree', true);
}

section('Another project does not inherit it');
{
  await connect('/home/adrian/code/other-app', 'other-app');
  const r = await page.evaluate(() => ({ block: projBlock(), panel: projPanelHTML() }));
  ok(r.block === '', 'a different folder starts with nothing', JSON.stringify(r.block).slice(0, 40));
  ok(/has not learned anything/.test(r.panel), 'and says so plainly', true);

  await connect('/home/adrian/code/my-app', 'my-app');
  const back = await page.evaluate(() => projBlock());
  ok(/npm test/.test(back), 'and coming back to the first one, it is all still there', true);
}

section('You can see it, and remove anything that is wrong');
{
  await page.evaluate(() => _devRenderProject());
  const ui = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.prj-f .prj-t')].map(e => e.textContent),
    how: [...document.querySelectorAll('.prj-f .prj-how')].map(e => e.textContent),
    closed: !document.querySelector('.prj').open,
  }));
  ok(ui.rows.length === 2, 'both facts are on the screen', ui.rows.length);
  ok(ui.how.every(h => /ran it/.test(h)),
     'each saying how it was learned, which is the difference from a rumour', ui.how);
  ok(ui.closed === true, 'closed by default, so it does not push the composer away', ui.closed);

  await page.evaluate(() => {
    document.querySelector('.prj').open = true;
    const b = [...document.querySelectorAll('[data-prj-forget]')]
      .find(x => /npm test/.test(x.dataset.prjForget));
    b.click();
  });
  await page.waitForFunction(() => !projBlock().includes('npm test'), null, { timeout: 6000 });
  const after = await page.evaluate(() => ({ block: projBlock(), rows: document.querySelectorAll('.prj-f').length }));
  ok(!/npm test/.test(after.block), 'forgetting it takes it out of the prompt', true);
  ok(after.rows === 1, 'and off the screen', after.rows);
}

section('Signing in does not wipe what was learned as a guest');
{
  /* The module is evaluated before sign-in is restored, so it first reads the
     guest scope. If a later save wrote that empty list under the account's own
     key, everything AMV knew about every project would be gone on the next
     turn, silently. */
  const kept = await page.evaluate(() => {
    PROJ.scope = 'someone-else@example.com';         // as if loaded for another account
    const block = projBlock();                        // any read must notice and reload
    return { scope: PROJ.scope, block };
  });
  ok(kept.scope === 'test@amv.dev',
     'a read notices the account changed and reloads for it', kept.scope);
  ok(/node build\.mjs/.test(kept.block),
     'so the facts are still there rather than overwritten with nothing', true);
}

section('It survives a reload, which is the whole point');
{
  /* Read through `load`, not by the bare key: every key here is scoped to the
     signed-in account, and reading the raw name finds the guest scope - which
     is my mistake, and is also exactly the bug it uncovered in the module. */
  const stored = await page.evaluate(() => load('amv_projects') || []);
  ok(Array.isArray(stored), 'it is stored as a list, so two devices merge item by item', Array.isArray(stored));
  /* One, not two: `other-app` was opened and nothing was ever learned in it,
     so it was never created. A project with no facts is not worth a row - and
     storing one would put an empty record into everybody's sync for every
     folder they ever opened. */
  ok(stored.length === 1, 'the project with facts is stored, the empty one is not', stored.length);
  ok(stored[0].facts.length === 1, 'with what survived being forgotten', stored[0].facts.length);
  ok(stored.every(p => p.id && p.updated), 'each with the id and stamp the merge needs', true);
  ok(!JSON.stringify(stored).includes('/home/adrian'),
     'and no path anywhere in what would be uploaded', true);

  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => { S.user = { name:'Test', email:'test@amv.dev', ini:'T' }; goApp(); setTab('dev'); });
  await connect('/home/adrian/code/my-app', 'my-app');
  const back = await page.evaluate(() => projBlock());
  ok(/node build\.mjs/.test(back), 'after a reload AMV still knows the project', true);
  ok(!/npm test/.test(back), 'and still does not know what you told it to forget', true);
}

section('No JavaScript errors');
{
  ok(A.errors.length === 0, 'zero uncaught page errors', A.errors.slice(0, 3));
}

await A.close();
if (report('it-remembers-your-project-between-sessions') > 0) process.exitCode = 1;
done();
