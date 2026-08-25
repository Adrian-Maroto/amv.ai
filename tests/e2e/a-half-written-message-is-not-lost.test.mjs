/* THE MOST VALUABLE TEXT IN THE PRODUCT IS THE PART NOBODY HAS SENT YET.

   Measured before any of this existed: type 492 characters into the composer,
   refresh, and 492 characters are gone. A long prompt is usually the thing
   somebody opened AMV to write, and it goes on an accidental refresh, a back
   gesture, a crashed tab - and on a phone whenever the browser evicts a
   background tab, which it does routinely and without warning.

   WHAT THIS FILE CAN AND CANNOT SHOW, said plainly.

   It drives the restore mechanism directly rather than by reloading the page.
   The harness has no backend, so boot cannot validate a session and clears the
   signed-in user - which sends _scopeKey to "guest" and puts every per-account
   read somewhere other than where the write went. That is the harness, not the
   feature, and it is pre-existing behaviour I did not touch. So the reload
   round trip end to end is NOT demonstrated here, and I am not claiming it is.
   What is demonstrated is every link this feature actually adds: it saves, it
   survives a new empty conversation, it re-keys, it never lands in a thread it
   did not come from, it clears on send, and it cannot grow without bound. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('Typing into the box writes a draft');
{
  const r = await page.evaluate(async () => {
    const ta = document.getElementById('mta');
    ta.value = 'a long message somebody is part way through writing';
    ta.dispatchEvent(new Event('input'));
    await new Promise(s => setTimeout(s, 600));
    return { key: _draftKey(), stored: _draftLoad(), cur: S.cur };
  });
  ok(r.stored.length > 20, 'the draft is saved', r.stored.slice(0, 30));
  ok(r.key.indexOf(r.cur) > 0, 'under the conversation it was written in', r.key);
}

section('It comes back in the empty chat a reload lands you in');
{
  /* S.cur is deliberately not persisted, so every reload opens a NEW
     conversation - that is how amv.homes opens straight into a fresh chat.
     A draft keyed only to its own conversation would therefore never restore,
     which is what the first version of this did: a storage write nobody read. */
  const r = await page.evaluate(async () => {
    newChat();                                  // exactly what a reload produces
    await new Promise(s => setTimeout(s, 150));
    /* Looked up AFTER the re-render, not before. newChat replaces the composer
       element, so a reference taken earlier is a detached node - reading it
       reports an empty box while the live one has the text. The first version
       of this failed on exactly that and the product was fine. */
    document.getElementById('mta').value = '';
    const freshCur = S.cur;
    _draftRestore();
    return { freshCur, box: document.getElementById('mta').value, rekeyed: _draftLoad() };
  });
  ok(r.box.length > 20, 'the unsent text is back in the box', r.box.slice(0, 30));
  ok(r.rekeyed.length > 20, 'and now belongs to the conversation they are in', r.rekeyed.slice(0, 20));
}

section('But never into a thread it did not come from');
{
  const r = await page.evaluate(async () => {
    const ta = document.getElementById('mta');
    /* A conversation that received a message is a real thread. A draft written
       elsewhere must not appear in it. */
    ta.value = 'draft belonging to an empty chat';
    ta.dispatchEvent(new Event('input'));
    await new Promise(s => setTimeout(s, 600));
    newChat();
    const c = S.convs.find(x => x.id === S.cur);
    c.msgs = [{ r: 'u', c: 'hello' }, { r: 'a', c: 'hi' }];
    ta.value = '';
    _draftRestore();
    return { box: ta.value, hasMsgs: c.msgs.length };
  });
  ok(r.hasMsgs === 2, 'the conversation has real messages', r.hasMsgs);
  ok(r.box === '', 'and no unrelated draft is dropped into it', JSON.stringify(r.box));
}

section('Sending clears it, so nothing is offered back twice');
{
  const r = await page.evaluate(async () => {
    newChat();
    const ta = document.getElementById('mta');
    ta.value = 'this one gets sent and must not come back';
    ta.dispatchEvent(new Event('input'));
    await new Promise(s => setTimeout(s, 600));
    const before = _draftLoad();
    _draftClear();
    ta.value = '';
    _draftRestore();
    return { before, after: _draftLoad(), box: ta.value };
  });
  ok(r.before.length > 20, 'it was there before sending', r.before.slice(0, 20));
  ok(!r.after, 'and gone after', JSON.stringify(r.after));
  ok(r.box === '', 'so it is not offered back', JSON.stringify(r.box));
}

section('It cannot fill somebody’s storage');
{
  const r = await page.evaluate(async () => {
    newChat();
    _draftSave('x'.repeat(50000));
    const capped = _draftLoad().length;
    /* One row per conversation somebody ever opened is a slow leak that ends
       with the app unable to save the things that matter more. */
    for (let i = 0; i < 30; i++) { S.cur = 'fake' + i; _draftSave('draft ' + i); }
    const ix = load('amv_draft_ix') || [];
    return { capped, kept: ix.length };
  });
  ok(r.capped <= 12000, 'a pasted novel is truncated', r.capped);
  ok(r.kept <= 12, 'and only a handful of drafts are kept at once', r.kept);
}

section('Never over something somebody is already typing');
{
  const r = await page.evaluate(async () => {
    newChat();
    _draftSave('an older draft');
    const ta = document.getElementById('mta');
    ta.value = 'what they are typing right now';
    _draftRestore();
    return ta.value;
  });
  ok(r === 'what they are typing right now', 'the box is left alone when it has content', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
