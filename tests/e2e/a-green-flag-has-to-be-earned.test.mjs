/* "IF IT IS GENUINELY NOT POSSIBLE, SAY SOMETHING THAT SHOWS YOU CAN'T DO IT."

   And the other half of the same instruction: "before it says added
   automatically it reviews it and requests for any access it needs and then
   when it has everything it needs say like running or the green flag to show
   it's actually running."

   Both are about the same failure, which is a product claiming something that
   is not true. Before this, a request went straight past the question of
   whether AMV could do it at all: "log into random accounts every day" was
   read as RECURRING, offered as something to add to Running jobs, and would
   have been added - then reported every morning that it could not do the thing
   nobody could ever have done. That is the worst kind of bug, because it looks
   exactly like the product working.

   WHAT THIS MEASURES AND WHAT IT CANNOT.

   The general answer - can any combination of what exists finish this - lives
   in the planner, because that is the only thing holding the whole connector
   catalog. There is no engine in a test, so the planner is STUBBED here and
   what is measured is the contract around it: that a refusal is parsed rather
   than mistaken for an empty plan, that it is rendered as cannot rather than
   as an error, and that nothing is scheduled behind it. Whether the model
   judges any particular request correctly is not something a suite can assert,
   and this file does not pretend to.

   The floor - the handful of things no browser tab can ever do - is a pure
   function, so that IS measured directly, including that it does not fire on
   requests which merely look ambitious. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('The floor answers with no engine, no key and no network');
{
  const r = await page.evaluate(() => {
    const f = q => { const v = _feasFloor(q); return v ? v.edge : null; };
    return {
      lift:   f('drive me to the airport on friday'),
      print:  f('print this out and put it on my desk'),
      theirs: f('log into random facebook accounts and post for me'),
      friend: f("check my friend's inbox for the invoice"),
      reply:  f('make him reply to my email'),
      viral:  f('guarantee my video goes viral'),
      exam:   f('sit my exam for me on tuesday'),
      /* The ones that must NOT fire. Every one of these is a real thing AMV
         does, and a scanner that refuses them is worse than no scanner. */
      email:  f('email the mayor every day about the bike lane'),
      book:   f('book me a taxi to the airport on friday'),
      draft:  f('draft a letter I can print and sign'),
      find:   f('find me a printer near me that is open now'),
      watch:  f('watch for tickets and tell me when they drop'),
      apply:  f('apply to every junior design job in Berlin this week'),
    };
  });
  ok(r.lift === 'in-person', 'a lift needs a body', String(r.lift));
  ok(r.print === 'in-person', 'so does printing something onto paper', String(r.print));
  ok(r.theirs === 'their-account', "somebody else's account is not AMV's to use", String(r.theirs));
  ok(r.friend === 'their-account', 'including a friend’s', String(r.friend));
  ok(r.reply === 'other-people', 'nobody can promise what another person does', String(r.reply));
  ok(r.viral === 'other-people', 'and nobody can promise an audience', String(r.viral));
  ok(r.exam === 'is-you', 'an exam is tied to the person sitting it', String(r.exam));

  ok(r.email === null, 'emailing a public figure daily is possible, so it is allowed', String(r.email));
  ok(r.book === null, 'booking the taxi is the thing AMV does', String(r.book));
  ok(r.draft === null, 'drafting something to print is not printing it', String(r.draft));
  ok(r.find === null, 'finding a printer is research', String(r.find));
  ok(r.watch === null, 'watching for a drop is not buying one', String(r.watch));
  ok(r.apply === null, 'applying for jobs is the product', String(r.apply));
}

section('An impossible request is answered, not planned around');
{
  const r = await page.evaluate(async () => {
    const box = document.getElementById('mc-cmd-result')
      || (() => { const d = document.createElement('div'); d.id = 'mc-cmd-result'; document.body.appendChild(d); return d; })();
    box.innerHTML = '';
    const before = _loadSched().length;
    await mcRunCommand('log into random facebook accounts every day and post for me');
    return { html: box.innerHTML, jobsBefore: before, jobsAfter: _loadSched().length };
  });
  ok(/cannot/.test(r.html), 'it says it cannot, on the cannot treatment', r.html.slice(0, 80));
  ok(!/Add to Running jobs/.test(r.html), 'it is not offered as a job to add');
  ok(r.jobsAfter === r.jobsBefore, 'and nothing was scheduled', r.jobsBefore + '->' + r.jobsAfter);
  ok(/What I can do instead/.test(r.html), 'it offers what it would do instead');
}

section('A refusal from the planner is read as a refusal, not as an empty plan');
{
  /* The parse is the part that goes wrong quietly: a refusal object carries an
     "instead" ARRAY, so code looking for the first "[" finds one INSIDE the
     object and parses the wrong thing - losing the reason and showing a
     fallback plan for something that cannot be done. */
  const r = await page.evaluate(() => {
    const refusal = 'Here is my answer:\n{"impossible":true,"why":"no service here can post to that site.",'
                  + '"instead":["find the form and hand you the link","draft what to say"]}';
    const plan = '[{"title":"Send it","tool":"gmail.send","args":{},"needs_approval":true}]';
    const v = _feasParse(refusal);
    return {
      why: v && v.why, n: v && v.instead.length,
      planIsNotRefusal: _feasParse(plan) === null,
      prose: _feasParse('I cannot do that.') === null,
    };
  });
  ok(/no service here/.test(r.why || ''), 'the reason survives the parse', String(r.why));
  ok(r.n === 2, 'and so does what it would do instead', String(r.n));
  ok(r.planIsNotRefusal, 'a real plan is not mistaken for a refusal');
  ok(r.prose, 'and prose with no JSON in it is not either');
}

section('A plan bound to nothing real is not a plan');
{
  const r = await page.evaluate(() => ({
    fiction: AMVFeasible.planIsFiction([{ tool: 'teleport.go' }, { tool: 'timemachine.set' }]),
    oneBad:  AMVFeasible.planIsFiction([{ tool: 'teleport.go' }, { tool: 'browser.do' }]),
    empty:   AMVFeasible.planIsFiction([]),
  }));
  ok(r.fiction === true, 'every step naming a connector that does not exist is fiction');
  ok(r.oneBad === false, 'one unknown tool among real ones is an ordinary blocked step');
  ok(r.empty === false, 'no steps is not the same claim');
}

section('...and the planner actually asks it');
{
  /* THE CHECK AND THE ROUTE THAT USES IT ARE TWO CLAIMS, and only the first
     is proven above. A test that reads a verifier can tell you the verifier
     works; it cannot tell you anything is wired to it, and the version of
     this file that stopped at the section above proved exactly nothing about
     what somebody sees. So this one goes through plan() itself. */
  const r = await page.evaluate(async () => {
    const realReady = window._aiBackendReady, realComplete = window.aiComplete;
    window._aiBackendReady = () => true;
    /* A confident plan naming tools that are not there - which is what a
       planner asked for steps does when nothing can do the job. */
    window.aiComplete = async () => JSON.stringify([
      { title: 'Open the machine', tool: 'teleport.go', args: {}, needs_approval: false },
      { title: 'Set the year', tool: 'timemachine.set', args: {}, needs_approval: false },
    ]);
    const fake = await AMVUniversal.plan('take me back to last tuesday');
    /* And the control: a plan naming a connector that IS registered must come
       back as an ordinary plan, or this check would refuse everything. */
    window.aiComplete = async () => JSON.stringify([
      { title: 'Look it up', tool: 'browser.do', args: { url: 'https://x.test', goal: 'read' }, needs_approval: false },
    ]);
    const real = await AMVUniversal.plan('find me the opening hours');
    window._aiBackendReady = realReady; window.aiComplete = realComplete;
    return {
      fakeImpossible: !!fake.impossible, fakeEdge: fake.edge, fakeWhy: fake.why || '',
      fakeInstead: (fake.instead || []).length,
      realImpossible: !!real.impossible, realSteps: (real.steps || []).length,
    };
  });
  ok(r.fakeImpossible, 'a plan naming nothing real comes back as cannot, not as three blocked steps');
  ok(r.fakeEdge === 'no-tools', 'and says which of the three layers answered', String(r.fakeEdge));
  ok(/nothing AMV can reach/.test(r.fakeWhy), 'in words somebody can read', r.fakeWhy.slice(0, 50));
  ok(r.fakeInstead >= 2, 'with things it would do instead', String(r.fakeInstead));
  ok(!r.realImpossible && r.realSteps === 1,
     'while a plan bound to a real connector is left alone',
     r.realImpossible + '/' + r.realSteps);
}

section('Nothing says running until the review says it can');
{
  const r = await page.evaluate(async () => {
    /* The planner stubbed to return a real step bound to a connector that is
       registered but NOT connected - which is what "it needs access" looks
       like from the inside. */
    const realPlan = AMVUniversal.plan;
    AMVUniversal.plan = async () => ({ steps: [{ title: 'Read the inbox', tool: 'gmail.list', args: {}, needs_approval: false }] });
    const rev = await _mcReview('summarise my inbox every morning', 'require');
    AMVUniversal.plan = realPlan;
    return { checked: rev.checked, needs: rev.needs.map(n => n.code), impossible: rev.impossible };
  });
  ok(r.checked === true, 'the review ran');
  ok(r.needs.length > 0, 'and found what is missing', JSON.stringify(r.needs));
  ok(r.impossible === false, 'which is a requirement, not an impossibility');
}

section('It asks for the access before it creates anything');
{
  const r = await page.evaluate(async () => {
    const box = document.getElementById('mc-cmd-result');
    box.innerHTML = '';
    const before = _loadSched().length;
    _mcNeedsFirst(box, 'summarise my inbox every morning', { label: 'every morning', freq: 'daily' }, 'require',
      { needs: [{ code: 'needs_auth', need: 'Gmail', how: 'Connect Gmail in Settings -> Connectors.', connector: 'Gmail' }], checked: true });
    return { html: box.innerHTML, added: _loadSched().length - before };
  });
  ok(/Nothing has been added yet/.test(r.html), 'it says outright that nothing was created');
  ok(r.added === 0, 'and nothing was', String(r.added));
  ok(/Connect Gmail/.test(r.html), 'it names the connection and offers it');
  ok(/waits/.test(r.html), 'with an honest way to add it anyway');
}

section('A review that could not run does not get a green flag');
{
  const r = await page.evaluate(async () => {
    const box = document.getElementById('mc-cmd-result');
    box.innerHTML = '';
    /* The server says yes, and the review never ran - no engine to plan with.
       Two of the three conditions for the claim, which is not enough. */
    const realSrv = window._mcScheduleServer;
    window._mcScheduleServer = async () => ({ ok: true, id: 'srv1' });
    await _mcSchedule(box, 'do a thing every day', { label: 'every day', freq: 'daily' }, 'require',
      { needs: [], checked: false });
    const unchecked = box.innerHTML;
    box.innerHTML = '';
    await _mcSchedule(box, 'do a thing every day', { label: 'every day', freq: 'daily' }, 'require',
      { needs: [], checked: true });
    const checked = box.innerHTML;
    window._mcScheduleServer = realSrv;
    return { unchecked, checked };
  });
  ok(!/Running/.test(r.unchecked), 'an unchecked job is not called running', r.unchecked.slice(0, 90));
  ok(/could not check/.test(r.unchecked), 'and it says why it cannot promise that');
  ok(/Running/.test(r.checked), 'a reviewed job with nothing missing is', r.checked.slice(0, 90));
}

section('And the way out of a dead end actually goes somewhere');
{
  /* The buttons under "What I can do instead" are the whole reason this is
     not a refusal screen. Asserting that the MARKUP contains them says
     nothing about whether pressing one does anything - they go through the
     delegated data-dact dispatcher, which is exactly the mechanism that has
     silently dropped buttons in this codebase before. So one is pressed. */
  const r = await page.evaluate(async () => {
    const box = document.getElementById('mc-cmd-result');
    box.innerHTML = '';
    _mcCannot(box, { why: 'it needs hands.', instead: ['book it with somebody who has hands'] }, 'drive me there');
    const btn = box.querySelector('.mc-cannot-opts .btn');
    if(!btn) return { noButton: true };
    btn.click();
    await new Promise(s => setTimeout(s, 250));
    const input = document.getElementById('mc-cmd-input');
    return { noButton: false, typed: input ? input.value : '', focused: document.activeElement === input };
  });
  ok(!r.noButton, 'there is an alternative to press');
  ok(/book it with somebody/.test(r.typed),
     'and pressing it puts that request in the box, ready to run', JSON.stringify(r.typed));
}

section('A card somebody can actually switch on shows its example too');
{
  /* Browsing on the free plan renders the LOCKED card, so every assertion
     above this point measured that one. The card a paying customer sees is a
     separate function with its own copy of the markup, which is precisely how
     one of two near-identical branches ends up missing a change. */
  const r = await page.evaluate(() => {
    const job = { id: 'x1', title: 'Daily inbox digest', desc: 'Each evening, the few emails that need you.',
                  needs: 'Email', icon: '\uD83D\uDCEC', on: false,
                  sample: ['6 needed you today. 58 did not.', 'and four more lines'] };
    const live = _cwJobCard(job);
    const locked = _cwLockedCard(job);
    const noSample = _cwJobCard({ id: 'x2', title: 'T', desc: 'D', needs: 'Web research', icon: '\u2600', on: false });
    return {
      liveHas: /cw-job-out/.test(live) && /6 needed you today/.test(live),
      lockedHas: /cw-job-out/.test(locked) && /6 needed you today/.test(locked),
      liveOneLine: (live.match(/and four more lines/g) || []).length === 0,
      noSampleClean: !/cw-job-out/.test(noSample),
    };
  });
  ok(r.liveHas, 'the switchable card carries the example');
  ok(r.lockedHas, 'and so does the one shown while browsing');
  ok(r.liveOneLine, 'only the first line of it, on both');
  ok(r.noSampleClean, 'and a job with no example renders no empty box');
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
