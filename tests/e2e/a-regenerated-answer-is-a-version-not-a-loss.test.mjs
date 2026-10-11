/* A REGENERATED ANSWER IS A VERSION, NOT A LOSS.

   Regenerating an answer, or editing a message, used to throw away what was
   there. Now each is a version of the turn, and "‹ 2 / 3 ›" under the message
   moves between them. In a real browser, with the engine stood in for (so the
   answers are known), and the person's own buttons pressed:

   - regenerating keeps the first answer; the switcher goes back to it and
     forward again, and the chat carries on from the one chosen;
   - editing a message keeps what was asked before, and its answer, as a
     version too;
   - an error is not kept as a version - it is not an answer anyone wants;
   - the versions are bounded, so a chat cannot grow without limit;
   - they are saved with the chat. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

await page.evaluate(() => {
  window.__n = 0;
  /* The engine: answers "Answer N", one more each time it is asked. */
  window._callAI = async (msgs) => { window.__n++; msgs.push({ r: 'a', c: 'Answer ' + window.__n }); setMsgs(msgs); S.busy = false; renderChatMsgs(); };
  window.showTextPromptAsync = async () => window.__edit;
  const c = newConvObj('t'); S.convs.unshift(c); S.cur = c.id;
  setMsgs([{ r: 'u', c: 'What is a lease?', d: 'What is a lease?' }, { r: 'a', c: 'Answer 0' }]);
  renderChatMsgs();
});
const state = () => page.evaluate(() => {
  const m = getMsgs();
  const sw = document.querySelector('.ver-n');
  return { texts: m.map(x => x.c), alts: (m[0].alts || []).length, cur: m[0].altCur, label: sw ? sw.textContent : '' };
});

section('Regenerating keeps the first answer, and the switcher goes back to it');
{
  await page.evaluate(() => regenerateMsg());
  let s = await state();
  ok(s.texts.join('|') === 'What is a lease?|Answer 1' && s.label === '2 / 2', 'the new answer, as version 2 of 2', s);
  await page.click('[data-action="ver-prev"]');
  s = await state();
  ok(s.texts.join('|') === 'What is a lease?|Answer 0' && s.label === '1 / 2', 'back to the first answer', s);
  ok(await page.evaluate(() => document.querySelector('[data-action="ver-prev"]').disabled), 'and there is nothing before it');
  await page.click('[data-action="ver-next"]');
  s = await state();
  ok(s.texts.join('|') === 'What is a lease?|Answer 1' && s.label === '2 / 2', 'and forward again', s);
}

section('Editing a message keeps what was asked before as a version');
{
  await page.evaluate(() => { window.__edit = 'What is a sublease?'; return editMsg(0); });
  let s = await state();
  ok(s.texts.join('|') === 'What is a sublease?|Answer 2' && s.label === '3 / 3', 'the edited question and its answer, version 3', s);
  await page.click('[data-action="ver-prev"]');
  s = await state();
  ok(s.texts.join('|') === 'What is a lease?|Answer 1' && s.label === '2 / 3', 'the question as it was, with the answer it had', s);
}

section('The chat carries on from the version chosen');
{
  await page.evaluate(() => { const m = getMsgs(); m.push({ r: 'u', c: 'And who pays repairs?' }); setMsgs(m); return _callAI(m); });
  const s = await state();
  ok(s.texts.join('|') === 'What is a lease?|Answer 1|And who pays repairs?|Answer 3', 'the next turn follows version 2', s.texts);
  await page.click('[data-action="ver-next"]');
  const t = await state();
  ok(t.texts.join('|') === 'What is a sublease?|Answer 2', 'switching to version 3 shows that branch on its own', t.texts);
  await page.click('[data-action="ver-prev"]');
  const u = await state();
  ok(u.texts.join('|') === 'What is a lease?|Answer 1|And who pays repairs?|Answer 3', 'and coming back finds the conversation that grew from version 2', u.texts);
}

section('An error is not kept as a version');
{
  const r = await page.evaluate(() => {
    const c = newConvObj('e'); S.convs.unshift(c); S.cur = c.id;
    setMsgs([{ r: 'u', c: 'Hello' }, { r: 'a', c: '', _error: true }]);
    return regenerateMsg().then(() => ({ alts: (getMsgs()[0].alts || []).length, texts: getMsgs().map(x => x.c) }));
  });
  ok(r.alts === 0, 'the failed attempt left no version behind', r);
}

section('Versions are bounded');
{
  const r = await page.evaluate(async () => {
    const c = newConvObj('b'); S.convs.unshift(c); S.cur = c.id;
    setMsgs([{ r: 'u', c: 'Write a poem' }, { r: 'a', c: 'x'.repeat(9000) }]);
    window._callAI = async (msgs) => { msgs.push({ r: 'a', c: 'y'.repeat(9000) }); setMsgs(msgs); S.busy = false; renderChatMsgs(); };
    for (let i = 0; i < 12; i++) await regenerateMsg();
    const m = getMsgs()[0];
    return { n: m.alts.length, size: JSON.stringify(m.alts).length };
  });
  ok(r.n <= 8 && r.size <= 40000, 'at most eight versions and 40,000 characters of them', r);
}

section('They are saved with the chat');
{
  const saved = await page.evaluate(() => {
    const id = S.cur; _autoSave();
    const back = (loadUserConvs(S.user.email) || []).find(c => c.id === id);
    const m = back && back.msgs && back.msgs[0];
    return { n: m && Array.isArray(m.alts) ? m.alts.length : 0, cur: m && m.altCur };
  });
  ok(saved.n > 1 && typeof saved.cur === 'number', 'the versions are in what the chat stores, read back the way a reload reads it', saved);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-regenerated-answer-is-a-version-not-a-loss') > 0) process.exitCode = 1;
done();
