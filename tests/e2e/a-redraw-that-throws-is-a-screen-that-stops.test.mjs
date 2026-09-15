/* THE COMMENT DESCRIBED TWO FUNCTIONS THAT WERE NEVER WRITTEN.

   _vcInUse used to cancel a coalesced redraw whenever any field in the view
   held text, so a word left in the Crew command box meant nothing new ever
   appeared. Removing it was right. What replaced it was a comment saying the
   typing is now carried across the redraw by `_vcSnapshotInputs` /
   `_vcRestoreInputs` "above" - and two call sites. Neither function existed.

   So _reRenderSoon threw a ReferenceError before it ever reached the render.
   Every background repaint on Crew and Handoff was dead, not merely cancelled:
   strictly worse than the fault being fixed, and silent, because the throw
   landed inside a setTimeout where no suite was looking and no catch reported
   it.

   Nothing caught it. The dead-guards stage covers a typeof guard naming
   nothing and a call inside a swallowing catch; a BARE call to a name that
   exists nowhere is neither.

   So this checks the two things that were claimed and were not true:
   the redraw RUNS, and what somebody had typed is still there afterwards -
   including where the cursor was. And it watches for uncaught errors while it
   does, because the absence of one is the part that was missing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The functions the redraw path calls exist');
{
  const t = await page.evaluate(() => ({
    snapshot: typeof _vcSnapshotInputs,
    restore: typeof _vcRestoreInputs,
    reRender: typeof _reRenderSoon,
  }));
  ok(t.reRender === 'function', '_reRenderSoon is there', t);
  ok(t.snapshot === 'function', '_vcSnapshotInputs is a function, not a comment', t);
  ok(t.restore === 'function', '_vcRestoreInputs is a function, not a comment', t);
}

section('A coalesced redraw actually renders');
{
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 700));
    let ran = 0;
    _reRenderSoon(() => { ran++; }, 'crew');
    await new Promise(r => setTimeout(r, 400));
    return { ran, tab: S.tab };
  });
  ok(r.ran === 1, 'the scheduled render runs exactly once', r);
}

section('What was typed survives the redraw, with the cursor where it was');
{
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 700));
    const box = document.querySelector('#vc input[id], #vc textarea[id]');
    if (!box) return { noBox: true };
    const id = box.id;
    box.focus();
    box.value = 'chec';
    try { box.setSelectionRange(4, 4); } catch (e) {}
    let rendered = false;
    _reRenderSoon(() => { rendered = true; renderCrewView(); }, 'crew');
    await new Promise(r => setTimeout(r, 500));
    const after = document.getElementById(id);
    return {
      id, rendered,
      /* The field must really have been REPLACED. If the renderer left the
         same node in place, carrying the value across it proves nothing. */
      replaced: after !== box,
      exists: !!after,
      value: after ? after.value : null,
      focused: after === document.activeElement,
      caret: after ? (() => { try { return after.selectionStart; } catch (e) { return 'n/a'; } })() : null,
    };
  });
  ok(!r.noBox, 'Crew has a field to type into', r);
  ok(r.rendered === true, 'the redraw was not cancelled by the typing', r);
  ok(r.replaced === true, 'and the field was genuinely replaced by it', r);
  ok(r.value === 'chec', 'the half-typed command is still there', r);
  ok(r.focused === true, 'focus is still in it', r);
  ok(r.caret === 4, 'and the cursor is where it was', r);
}

section('A value the renderer supplied is not overwritten by a stale draft');
{
  /* The other direction, and the reason restore only refills an EMPTY field.
     A renderer that puts a real value in has said something newer than what
     was on screen a tenth of a second ago. */
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 600));
    const box = document.querySelector('#vc input[id], #vc textarea[id]');
    if (!box) return { noBox: true };
    const id = box.id;
    box.value = 'what I typed';
    const keep = _vcSnapshotInputs();
    box.value = 'what the server said';
    _vcRestoreInputs(keep);
    return { id, value: document.getElementById(id).value };
  });
  ok(r.value === 'what the server said',
     'a field the renderer filled keeps what the renderer put in it', r);
}

section('A redraw for a screen somebody has left still does not happen');
{
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 500));
    let ran = 0;
    _reRenderSoon(() => { ran++; }, 'crew');
    setTab('handoff');
    await new Promise(r => setTimeout(r, 450));
    return { ran, tab: S.tab };
  });
  ok(r.ran === 0, 'leaving the screen cancels its redraw', r);
  ok(r.tab === 'handoff', 'and the screen moved to is the one still showing', r);
}

section('None of it threw');
ok(errors.length === 0,
   'no uncaught page errors - the fault this file is about was exactly one of these',
   errors.slice(0, 3));

await app.close();
report();
done();
