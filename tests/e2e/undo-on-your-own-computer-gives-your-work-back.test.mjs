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
  /* THIS LINE USED TO SAY "and removes the file the turn created", AND THE
     RULE CHANGED DELIBERATELY.

     It was defensible: the re-read below captures their bytes into `after`
     first, so Redo brings the file back. But `after` lives in this tab. Close
     it, and an hour of somebody's work is gone from disk with no snapshot
     anywhere - real loss, silent, from pressing Undo on an unrelated turn.

     An Undo that leaves one file behind and SAYS SO is an inconvenience they
     can act on. So the irreversible half is withheld when the file is no
     longer what AMV wrote, and only then. A created file they never touched is
     still deleted, which the section further down holds - a rule that never
     deletes would be the half-undo this file exists to prevent. */
  ok('new.js' in r.out.afterUndo,
     'and KEEPS the file it created, because they had made it their own',
     Object.keys(r.out.afterUndo));
  ok(r.out.afterUndo['new.js'] === 'I CHANGED THIS TOO\n',
     'with their bytes, not the turn’s', r.out.afterUndo['new.js']);

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

/* ═════════════════════════════════════════════════════════════════════════
   A FILE THEY MADE THEIR OWN IS NOT AMV'S TO DELETE.  (AMV-AUD-007)

   Undo removes files the turn created, and it should: a turn that leaves its
   files behind has been half undone. But "created by the turn" and "theirs
   now" are not exclusive. AMV writes `notes.md`, the person spends an hour in
   it, then undoes the turn for an unrelated reason - and deleting it is not
   undoing AMV's work, it is destroying theirs.

   Overwriting an EDITED file is different and stays allowed: that is what Undo
   means, and the re-read above puts their version into `after` so Redo brings
   it back. A delete has no way home. That asymmetry is the whole rule.
   ═════════════════════════════════════════════════════════════════════════ */
section('A created file the person has since changed is kept, not deleted');
{
  const r = await run(`
    // they made the created file their own after the turn finished
    disk['new.js'] = 'HOURS OF MY OWN WORK\\n';
    await _agentToggleTurn(turn, 't1');     // Undo
    return {};
  `);
  ok('new.js' in r.disk,
     'the file is still on disk - Undo refused to delete work it did not write', JSON.stringify(Object.keys(r.disk)));
  ok(r.disk['new.js'] === 'HOURS OF MY OWN WORK\n',
     'with their bytes untouched', r.disk['new.js']);
  ok(!r.calls.includes('delete new.js'),
     'and no delete was even attempted', r.calls.join(' | '));
  /* The edited file is still rolled back, because that is what Undo is for
     and Redo can return it. Only the irreversible half is withheld. */
  ok(r.disk['app.js'] === 'ORIGINAL\n',
     'while the file the turn EDITED is still rolled back', r.disk['app.js']);
}

section('A created file they never touched is still deleted');
{
  /* The other side of it. A rule that never deletes is not a rule, it is the
     half-undo this whole file exists to prevent. */
  const r = await run(`
    await _agentToggleTurn(turn, 't1');     // Undo, with nothing edited by hand
    return {};
  `);
  ok(!('new.js' in r.disk),
     'gone, because it really was only ever AMV’s', JSON.stringify(Object.keys(r.disk)));
  ok(r.calls.includes('delete new.js'), 'the delete happened', r.calls.join(' | '));
}

/* ═════════════════════════════════════════════════════════════════════════
   AND THE DEFECT ONE STEP EARLIER: WHAT COUNTS AS A NEW FILE.

   `_agentRunTool` reads a file before editing it, to know whether it is
   creating or changing. It collapsed EVERY read failure into "not there" -
   so a transient error marked an existing file as created, wrote over it with
   no backup kept, and left Undo pointed at a delete.

   The bridge has always distinguished the two on the wire (ENOENT becomes 404
   `not_found`). What was missing was in the browser: the error carried no
   code, so the caller could not tell them apart. Only absence may create now,
   and any other failure refuses to write at all.
   ═════════════════════════════════════════════════════════════════════════ */
section('A read that fails is not taken as proof the file is new');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window.bridgeRead = async (p) => { calls.push('read ' + p); throw new Error('the disk is busy'); };
    window.runBridgeTool = async (n, i) => { calls.push('WROTE ' + i.path); return { path: i.path, bytes: 1 }; };
    /* MUTATED, NOT REPLACED. `_AGENT` is a top-level `const`, so the binding
       inside `_agentRunTool` cannot be reassigned from here - `window._AGENT =
       {...}` sets a property nothing reads and leaves the real object with its
       fields still null, which is the trap this repository has a gate stage
       for. The same object is what window holds, so assigning its fields works. */
    Object.assign(_AGENT, { seen: {}, created: {}, before: {}, after: {}, steps: [] });
    const out = await _agentRunTool('write_file', { path: 'existing.txt', content: 'NEW' }, {});
    return { out, calls, created: Object.keys(_AGENT.created), seen: Object.keys(_AGENT.seen) };
  });
  ok(r.out.ok === false, 'the write is refused', JSON.stringify(r.out));
  ok(!r.calls.some(c => c.startsWith('WROTE')),
     'and nothing was written - AMV does not overwrite a file it could not back up first',
     r.calls.join(' | '));
  ok(r.created.length === 0,
     'the path is NOT recorded as created, which is what Undo would have deleted', JSON.stringify(r.created));
  ok(r.seen.length === 0,
     'nor marked as already handled, so a later attempt in the same turn can try again', JSON.stringify(r.seen));
  ok(/could not read/i.test(r.out.text), 'and it says why', r.out.text);
}

section('A file that genuinely is not there still counts as created');
{
  /* The other side again. If absence stopped creating files, the agent could
     not write a new one at all, and the fix above would have broken the
     feature it was protecting. */
  const r = await page.evaluate(async () => {
    const calls = [];
    window.bridgeRead = async () => null;          // what not_found now returns
    window.runBridgeTool = async (n, i) => { calls.push('WROTE ' + i.path); return { path: i.path, bytes: 3 }; };
    /* MUTATED, NOT REPLACED. `_AGENT` is a top-level `const`, so the binding
       inside `_agentRunTool` cannot be reassigned from here - `window._AGENT =
       {...}` sets a property nothing reads and leaves the real object with its
       fields still null, which is the trap this repository has a gate stage
       for. The same object is what window holds, so assigning its fields works. */
    Object.assign(_AGENT, { seen: {}, created: {}, before: {}, after: {}, steps: [] });
    const out = await _agentRunTool('write_file', { path: 'brand-new.txt', content: 'NEW' }, {});
    return { out, calls, created: Object.keys(_AGENT.created) };
  });
  ok(r.out.ok === true, 'the write goes ahead', JSON.stringify(r.out));
  ok(r.calls.includes('WROTE brand-new.txt'), 'the file is written', r.calls.join(' | '));
  ok(r.created.includes('brand-new.txt'),
     'and it is recorded as created, so Undo can take it away again', JSON.stringify(r.created));
}

section('An existing file that reads fine is backed up before it is changed');
{
  const r = await page.evaluate(async () => {
    window.bridgeRead = async (p) => ({ path: p, content: 'WHAT WAS THERE' });
    window.runBridgeTool = async (n, i) => ({ path: i.path, bytes: 3 });
    /* MUTATED, NOT REPLACED. `_AGENT` is a top-level `const`, so the binding
       inside `_agentRunTool` cannot be reassigned from here - `window._AGENT =
       {...}` sets a property nothing reads and leaves the real object with its
       fields still null, which is the trap this repository has a gate stage
       for. The same object is what window holds, so assigning its fields works. */
    Object.assign(_AGENT, { seen: {}, created: {}, before: {}, after: {}, steps: [] });
    const out = await _agentRunTool('write_file', { path: 'existing.txt', content: 'NEW' }, {});
    return { out, created: Object.keys(_AGENT.created), before: _AGENT.before };
  });
  ok(r.out.ok === true, 'the write goes ahead', JSON.stringify(r.out));
  ok(r.created.length === 0, 'it is not called created', JSON.stringify(r.created));
  ok(r.before['existing.txt'] === 'WHAT WAS THERE',
     'and what was there is kept, which is what Undo puts back', JSON.stringify(r.before));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
