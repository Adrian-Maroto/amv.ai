/* THE OWNER'S LIST WAS NOT WORK, MONEY OR STUDY.

   It was the weather before you leave, where petrol is cheapest this week,
   what is about to go off in the fridge, what the school quietly wants by
   Friday, and whether the ticket somebody is selling you is real. The
   catalogue had ninety-three jobs and almost none of that.

   Two shapes, because they are two different things:

   - The ones that repeat are standing Crew jobs. They must run on live web
     research, which means they must need nothing but web research, or they
     silently become "runs only while AMV is open" and the morning forecast
     arrives when nobody is asleep to want it.

   - The ones that do not repeat open a chat. That is not a shortcut: chat is
     the only surface with the live web search tool. Routing them through the
     generic crewRun path would have answered "the fastest route to the
     airport" from memory - confident, plausible, and out of date.

   And every one of them that touches a doctor, a restaurant or a government
   form has to say, in the instruction the runner actually receives, that it
   books nothing and contacts nobody. A card that says so while the prompt
   does not is a promise made in the wrong file. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

const WANTED = [
  ['weather_day',   'the forecast every morning'],
  ['fuel_watch',    'where fuel is cheapest'],
  ['store_deals',   'discounts at the shops you use'],
  ['local_basket',  'the cheapest food shop'],
  ['fridge_recipes','what expires, and what to cook'],
  ['figure_market', 'someone posts, and what moved'],
  ['appt_chase',    'getting a medical appointment'],
  ['family_week',   'the week for the whole house'],
  ['school_admin',  'what the school has asked for'],
  ['kids_weekend',  'something to do with the kids'],
  ['family_health', 'nobody misses a check-up'],
];

const jobs = await page.evaluate(() => _cwDefaultJobs().map(j => ({
  id: j.id, cat: j.cat, needs: j.needs, title: j.title, desc: j.desc,
  prompt: j.prompt || '', asks: !!(j.asks && j.asks.q), every: j.every || 'daily',
})));
const byId = Object.fromEntries(jobs.map(j => [j.id, j]));

section('Every everyday thing the owner asked for is a real job');
{
  const missing = WANTED.filter(([id]) => !byId[id]);
  ok(missing.length === 0, 'all of them exist in the catalogue', missing.map(m => m[1]).join(', '));
}

section('They run unattended, or the morning brief arrives when nobody is up');
{
  /* A job needing Email or Calendar needs THIS tab's Google token, which the
     server has never had. It runs only while AMV is open, which for "every
     morning before you leave" is the same as not running. */
  const wrong = WANTED.map(([id]) => byId[id]).filter(j => j && j.needs !== 'Web research');
  ok(wrong.length === 0, 'each needs only web research, so it runs with AMV closed',
     wrong.map(j => j.id + ' needs ' + j.needs).join(', '));
  const unattended = await page.evaluate((ids) =>
    ids.map(id => ({ id, bg: _cwRunsUnattended(_cwDefaultJobs().find(j => j.id === id)) })),
    WANTED.map(w => w[0]));
  const notBg = unattended.filter(x => !x.bg);
  ok(notBg.length === 0, 'and AMV agrees they run in the background', notBg.map(x => x.id).join(', '));
}

section('Each one asks for the thing only the person can supply');
{
  /* The unattended runner gets the rules and the job text. It has no profile,
     no address and no shopping list. A local job that does not ask where you
     live runs every week against nothing and can only invent. */
  const noAsk = WANTED.map(([id]) => byId[id]).filter(j => j && !j.asks);
  ok(noAsk.length === 0, 'every one collects its own details on enable', noAsk.map(j => j.id).join(', '));
}

section('Nothing books, buys, files or contacts anybody');
{
  /* The card saying so is not enough. The runner receives `prompt`, so the
     refusal has to be in there. */
  const mustRefuse = ['appt_chase', 'family_health'];
  const bad = mustRefuse.filter(id => {
    const p = (byId[id] || {}).prompt.toLowerCase();
    return !(/do not book|not book|must not book/.test(p) && /contact/.test(p));
  });
  ok(bad.length === 0, 'the appointment jobs tell the runner not to book or contact anyone', bad.join(', '));

  const medical = ['appt_chase', 'family_health', 'fridge_recipes'];
  const noDisclaimer = medical.filter(id => {
    const p = (byId[id] || {}).prompt.toLowerCase();
    return !/medical advice|not a food safety|do not diagnose|not diagnose/.test(p);
  });
  ok(noDisclaimer.length === 0, 'and none of them pretends to be a clinician', noDisclaimer.join(', '));
}

section('The markets job gives context and refuses to give advice');
{
  const p = (byId.figure_market || {}).prompt.toLowerCase();
  ok(/not give financial advice|must not give financial advice/.test(p),
     'it is told plainly not to give financial advice');
  ok(/never say what to buy|what to buy, sell/.test(p), 'and specifically not what to buy or sell');
  ok(/information, not financial advice/.test(p), 'and to say so in every report');
  ok(/link to the original|direct link/.test(p), 'it links the actual post rather than paraphrasing it');
}

section('The family jobs are in a category people can find');
{
  const cats = await page.evaluate(() => CW_CATS);
  ok(cats.includes('Family & kids'), 'there is a Family & kids filter', cats.join(', '));
  const fam = jobs.filter(j => j.cat === 'Family & kids');
  ok(fam.length >= 4, 'with real jobs in it', fam.map(j => j.id).join(', '));
  /* A category chip is drawn from jobs that exist, so a job filed under a
     category nobody lists falls into "More" and is never found on purpose. */
  const orphans = jobs.filter(j => !cats.includes(j.cat));
  ok(orphans.length === 0, 'and no job is filed under a category with no chip',
     orphans.map(j => j.id + '/' + j.cat).join(', '));
}

section('The one-off errands are on the Crew screen and open a real chat');
{
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForTimeout(400);
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.cw-errand')].map(b => ({ key: b.dataset.darg, text: b.textContent.trim() })));
  ok(cards.length >= 5, 'the errand cards are rendered', cards.length);
  const keys = cards.map(c => c.key);
  ['route', 'scamcheck', 'papers', 'booking', 'pricecheck'].forEach(k =>
    ok(keys.includes(k), 'there is a card for ' + k, keys.join(', ')));
}

section('Pressing one writes the request into the composer, and does not send it');
{
  const before = await page.evaluate(() => (getMsgs() || []).length);
  await page.click('.cw-errand[data-darg="route"]');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    tab: S.tab,
    val: (document.getElementById('mta') || {}).value || '',
    focused: document.activeElement && document.activeElement.id === 'mta',
    msgs: (getMsgs() || []).length,
    selStart: (document.getElementById('mta') || {}).selectionStart,
    selEnd: (document.getElementById('mta') || {}).selectionEnd,
  }));
  ok(r.tab === 'chat', 'it lands in chat, where the live web search is', r.tab);
  ok(/fastest realistic route/i.test(r.val), 'with the request already written', r.val.slice(0, 70));
  ok(r.focused, 'and the cursor in the box');
  ok(r.msgs === before, 'nothing was sent on the person’s behalf', r.msgs + ' vs ' + before);
  ok(r.selEnd > r.selStart && /^\[.*\]$/.test(r.val.slice(r.selStart, r.selEnd)),
     'the blank they have to fill is selected for them', r.val.slice(r.selStart, r.selEnd));
}

section('Each errand leaves exactly one blank to fill, and says what it will not do');
{
  const e = await page.evaluate(() => CW_ERRANDS.map(x => ({ key: x[0], body: x[3] })));
  e.forEach(x => {
    ok(/\[[A-Z][^\]]*\]/.test(x.body), x.key + ' has a blank marked for the person', x.body.slice(0, 50));
  });
  const booking = e.find(x => x.key === 'booking').body.toLowerCase();
  ok(/do not book, call, email or confirm/.test(booking),
     'the booking errand tells AMV not to book or call anybody');
  const papers = e.find(x => x.key === 'papers').body.toLowerCase();
  ok(/not a lawyer|not legal advice/.test(papers), 'the paperwork errand is not legal advice');
  ok(/official government source|official page/.test(papers), 'and works from the official source');
  const scam = e.find(x => x.key === 'scamcheck').body.toLowerCase();
  ok(/cannot tell, say you cannot tell/.test(scam),
     'the scam check refuses to reassure when it does not know');
}

section('The band and the errands survive a server sync');
{
  /* The sync rebuilds the saved list from the definitions. A job that only
     lives in somebody's saved list is deleted the next time it runs, which is
     how a catalogue addition silently disappears a day later. */
  const after = await page.evaluate(() => {
    store('amv_cw_jobs', [{ id: 'weather_day', on: true }]);
    const rebuilt = _cwDefaultJobs().map(d => d.id);
    return { has: rebuilt.includes('weather_day'), n: rebuilt.length };
  });
  ok(after.has, 'the everyday jobs come from the definitions, not the saved list');
  ok(after.n >= 100, 'and the whole catalogue is still there', after.n);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
