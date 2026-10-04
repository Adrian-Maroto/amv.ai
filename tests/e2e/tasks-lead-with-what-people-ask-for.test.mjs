/* TASKS LEADS WITH WHAT PEOPLE ACTUALLY ASK FOR.

   Asked for: "update tasks section". It opened on ten "Only on AMV" cards,
   four of which restated a tab already in the rail (the daily brief, the
   brand canvas, the debug loop, the handoff), with the ready-made tasks below
   under Personal / Student / Work / Creative. People bring an assistant
   practical guidance, questions and writing - nearly 80% of conversations -
   so those groups come first, and the six cards that are only AMV come after. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'tasks', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.evaluate(() => setTab('tasks'));
await page.waitForTimeout(500);

section('The ready-made tasks come first, in the order people use an assistant');
{
  const r = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.tasks-page .tk-cat h3')].map(e => e.textContent.trim()),
    tasksTop: (document.querySelector('.tasks-page .tk-cat') || { getBoundingClientRect: () => ({ top: 1e9 }) }).getBoundingClientRect().top,
    uniqTop: (document.querySelector('.tasks-page .uniq-sec') || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top,
    uniq: [...document.querySelectorAll('.uniq-card .uniq-t')].map(e => e.textContent.trim()),
  }));
  ok(r.groups.slice(0, 3).join() === 'Advice & how-to,Find out,Writing', 'advice, finding out and writing first', r.groups);
  ok(r.groups[r.groups.length - 1] === 'Code', 'and code last - a small share of what people ask', r.groups);
  ok(r.tasksTop < r.uniqTop, 'the tasks sit above the cards about AMV', r);
  ok(r.uniq.length === 6 && !r.uniq.some(t => /Design a brand|Auto-debug|Daily brief|Hand off/.test(t)), 'six cards, none repeating a tab already in the rail', r.uniq);
}

section('Every task opens a chat with a real instruction in it');
{
  const r = await page.evaluate(() => [...document.querySelectorAll('.tk-row[data-darg]')].map(b => b.dataset.darg)
    .filter(k => !(typeof TASKS[k] === 'string' && TASKS[k].length > 40)));
  ok(r.length === 0, 'none points at a missing or empty prompt', r);
  for (const k of ['compare', 'lookup', 'edit']) {
    const v = await page.evaluate(async (k) => { setTab('tasks'); launchTask(k); await new Promise(r => setTimeout(r, 300)); return (document.getElementById('mta') || {}).value || ''; }, k);
    ok(v.length > 40 && /\[/.test(v), 'the "' + k + '" task fills the box with its instruction, blanks to fill in', v.slice(0, 50));
  }
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('tasks-lead-with-what-people-ask-for') > 0) process.exitCode = 1;
done();
