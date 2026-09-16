/* UNDO WROTE TO SOMEBODY'S REAL FILES AND KEPT NO WAY BACK.

   There are two halves to the same button. `_devToggleTurn` rolls back a
   project held in the browser; `_agentToggleTurn` rolls one back on the
   person's own disk, through the bridge. The browser half re-snapshots on the
   way down, with a comment saying exactly why: "so hand edits made after the
   turn are not thrown away by Redo". The machine half - the copy that cannot
   be recovered by reloading a page - did not.

   So: a turn edits a file, the person opens their own editor and changes it
   further, then presses Undo. Undo writes `before` over their work, which is
   what Undo means and is fine. But `after` is still the version the TURN
   produced, so Redo does not bring their change back - it overwrites it a
   second time with older content, and nothing anywhere still holds it.

   Nothing drove `_agentToggleTurn` at all, which is why the two halves could
   disagree. This drives it with the bridge calls stubbed, because the bug is in
   which bytes Undo decides to keep, not in the daemon that writes them - the
   daemon has its own suite. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A fake disk, and every bridge call the undo path can make pointed at it. */
const run = (script) => page.evaluate(async (src) => {
  const disk = { 'app.js': 'ORIGINAL\n' };
  const calls = [];
  window.bridgeRead = async (p) => {
    calls.push('read ' + p);
    if (!(p in disk)) throw new Error('not_found');
    return { path: p, content: disk[p] };
  };
  window.bridgeWrite = async (p, c) => { calls.push('write ' + p); disk[p] = c; return { path: p }; };
  window.bridgeDelete = async (p) => { calls.push('delete ' + p); delete disk[p]; return { path: p, removed: true }; };
  window._devBusy = () => {};
  window._devRenderLog = () => {};
  window.toast = () => {};

  /* What a turn leaves behind: what was there, what it wrote, what it made. */
  const turn = {
    machine: true, undone: false,
    before:  { 'app.js': 'ORIGINAL\n' },
    after:   { 'app.js': 'BY THE TURN\n', 'new.js': 'MADE BY THE TURN\n' },
    created: { 'new.js': true },
  };
  disk['app.js'] = 'BY THE TURN\n';
  disk['new.js'] = 'MADE BY THE TURN\n';

  const out = await (new Function('disk', 'calls', 'turn', 'return (async()=>{' + src + '})()'))(disk, calls, turn);
  return { disk, calls, out, undone: turn.undone, after: turn.after };
}, script);

section('A change made by hand after the turn survives Undo then Redo');
{
  const r = await run(`
    // the person edits both files themselves, after the turn finished
    disk['app.js'] = 'MY OWN EDIT\\n';
    disk['new.js'] = 'I CHANGED THIS TOO\\n';
    await _agentToggleTurn(turn, 't1');     // Undo
    const afterUndo = Object.assign({}, disk);
    await _agentToggleTurn(turn, 't1');     // Redo
    return { afterUndo };
  `);

  ok(r.out.afterUndo['app.js'] === 'ORIGINAL\n',
     'Undo puts the file back to before the turn, which is what Undo means', r.out.afterUndo['app.js']);
  ok(!('new.js' in r.out.afterUndo),
     'and removes the file the turn created', Object.keys(r.out.afterUndo));

  /* The half that was missing. */
  ok(r.disk['app.js'] === 'MY OWN EDIT\n',
     'Redo brings back what the PERSON had, not what the turn wrote', r.disk['app.js']);
  ok(r.disk['new.js'] === 'I CHANGED THIS TOO\n',
     'including in a file the turn created and they then changed', r.disk['new.js']);
  ok(r.calls.some(c => c.startsWith('read ')),
     'because the disk is read before it is rolled back', r.calls.slice(0, 4));
}

section('With no hand edit, Redo still restores exactly what the turn wrote');
{
  /* The re-read must not become a way for Redo to restore something else. If
     nothing changed since the turn, what comes back is the turn's own work. */
  const r = await run(`
    await _agentToggleTurn(turn, 't1');     // Undo
    await _agentToggleTurn(turn, 't1');     // Redo
    return {};
  `);
  ok(r.disk['app.js'] === 'BY THE TURN\n', 'the edit the turn made is back', r.disk['app.js']);
  ok(r.disk['new.js'] === 'MADE BY THE TURN\n', 'and the file it created is back', r.disk['new.js']);
  ok(r.undone === false, 'and the card is showing as applied again', r.undone);
}

section('A file that cannot be read does not erase what was already known');
{
  /* A stale `after` is a worse Redo; no `after` at all is no Redo. A read that
     fails has to leave the old snapshot standing. */
  const r = await run(`
    window.bridgeRead = async () => { throw new Error('disconnected'); };
    await _agentToggleTurn(turn, 't1');     // Undo
    await _agentToggleTurn(turn, 't1');     // Redo
    return {};
  `);
  ok(r.disk['app.js'] === 'BY THE TURN\n',
     'Redo still has the turn’s version to put back', r.disk['app.js']);
  ok(r.undone === false, 'and the round trip still completes', r.undone);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
