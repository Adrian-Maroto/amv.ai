/* THE PERSON DECIDING WHETHER TO PAY WAS SHOWN A PARAGRAPH.

   Crew is the reason somebody buys a plan, and until now a visitor on the free
   tier saw three sentences and a price where the product should have been. The
   catalogue - dozens of real jobs, each with the exact instruction it runs -
   sat behind the paywall, visible only to people who had already paid and
   therefore no longer needed convincing.

   That is the wrong way round, and it is also a much weaker pitch than the
   truth. "AMV works while you are not" is what every AI product on the internet
   claims. "Here are eighty-nine jobs, here is the literal instruction each one
   follows, here is the shape of what lands in your inbox" is a claim only a
   product that actually does it can make.

   So these cases are about the two ways that goes wrong. Either the examples
   are not shown to the person who needs them - or they are shown and they are
   hollow: a card with a nice title and nothing behind it, which is worse than
   the paragraph, because now they have caught you.

   Every job in the catalogue must carry the real instruction that will be sent
   to the runner. Not most. A visitor clicks the one that interests them, and
   the empty one is the one they click. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));
outbound.on(/model\.example/, () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 5 } }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9183',
  AMV_MODEL_KEY: 'k',
  MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }),
  },
});

const L = await bootLive({ env, outbound, port: 9183 });
const { page } = L;
const EMAIL = 'browsing@example.com';
const PW = 'A-real-Passw0rd!';
const KV = env.AMV_KV;

const catalogue = () => page.evaluate(() => _cwJobs().map(j => ({
  id: j.id, title: j.title, desc: j.desc, needs: j.needs, cat: j.cat,
  prompt: j.prompt || '', sample: j.sample || null,
})));

section('Every example in the catalogue has something real behind it');
{
  /* The assertion the whole feature stands on. A card is a promise; the
     instruction is whether the promise is kept. One hollow card in eighty-nine
     is not a rounding error - it is the one somebody clicks. */
  const jobs = await catalogue();
  ok(jobs.length >= 80, 'there is a real catalogue to browse', jobs.length);

  const hollow = jobs.filter(j => j.prompt.trim().length < 80).map(j => j.id);
  ok(hollow.length === 0,
     'every single job carries the instruction its runner will actually be given', hollow);

  const untitled = jobs.filter(j => !j.title || !j.desc || j.desc.length < 40).map(j => j.id);
  ok(untitled.length === 0, 'and every one says what it does in a real sentence', untitled);

  const noNeeds = jobs.filter(j => !j.needs).map(j => j.id);
  ok(noNeeds.length === 0, 'and declares what it needs, so none of them can pretend', noNeeds);
}

section('No job asks the runner to use something it was never given');
{
  /* The gap this section exists for, and it was live for a quarter of the
     catalogue.

     The unattended runner receives exactly two things: the rules, and the
     job's own text. It has no memory, no profile, and no list. So a preset
     instructing it to work from "the user's watch list" or "the deadlines they
     have listed" ran every morning against nothing - and a model given an
     instruction it cannot satisfy either apologises or invents, and inventing
     is worse.

     Every such job now asks for what it needs when it is switched on, and the
     answer goes into the detail, which IS what the runner is given. This check
     pairs the two so a new preset written in the same style cannot be added
     without a question to go with it. */
  const jobs = await page.evaluate(() => _cwJobs().map(j => ({
    id: j.id, prompt: j.prompt || '', asks: j.asks || null })));

  const needsInput = /user[’']?s? (watch|wish|stated|specified|listed|profile|test date|area|budget)|they have (listed|given|told|said|recorded)|the user has (listed|stated|told|given|specified)|user (profile|wish list|watch list)|has told you|have given you/i;

  const silent = jobs
    .filter(j => needsInput.test(j.prompt) && !(j.asks && j.asks.q))
    .map(j => j.id);
  ok(silent.length === 0,
     'every job that works from what the person told it actually asks them for it', silent);

  /* And the reverse, so the questions do not accumulate on jobs that do not
     need one - an unnecessary question is a reason not to switch a job on. */
  const asking = jobs.filter(j => j.asks && j.asks.q);
  ok(asking.length >= 15, 'the ones that need input are the ones asking', asking.length);
  /* The reverse direction is checked structurally in the next section, against
     any phrasing, rather than against this narrow phrase list - which only ever
     recognised about half the ways a prompt says "something of yours". */

  const vague = asking.filter(j => !j.asks.ph || j.asks.ph.length < 30).map(j => j.id);
  ok(vague.length === 0, 'each question shows an example of a real answer', vague);
}

section('And that holds however the instruction is phrased');
{
  /* The first version of the check above was a list of phrases, and it caught
     twenty-two jobs. Reading the prompts by hand found twenty-one more saying
     exactly the same thing in different words - "the specified hotels", "each
     watched page", "the named people", "the services the user has accounts
     with". A pattern that has to anticipate the wording is a pattern that
     misses half of them, which is what it did.

     So this asks the structural question instead: a job that needs NOTHING
     connected has only two possible sources of information - the live web, and
     what the person typed. If its instruction refers to anything of theirs at
     all, and it does not ask, there is no third place that could supply it. */
  const jobs = await page.evaluate(() => _cwJobs().map(j => ({
    id: j.id, prompt: j.prompt || '', needs: j.needs || '', asks: !!(j.asks && j.asks.q) })));

  const webOnly = jobs.filter(j => j.needs === 'Web research' && !j.asks);
  /* Anything possessive about the person, in any phrasing. */
  const personal = /\b(the user|their|your|the specified|the named|each watched|the watched)\b/i;
  const unbacked = webOnly.filter(j => personal.test(j.prompt)).map(j => j.id);
  ok(unbacked.length === 0,
     'no job works from the web alone while talking about something of theirs', unbacked);

  /* A rule with nothing to apply to proves nothing, so check it has teeth:
     the web-only category is large, and it is large because those jobs ask
     rather than because the category is empty.

     Worth recording that the first version of this asserted the opposite - that
     some web-only jobs need no input at all - and that turned out to be false.
     Every single one of them is personalised. A job that reads the open web and
     tells you something about nobody in particular is not a job anybody would
     switch on. */
  const webAll = jobs.filter(j => j.needs === 'Web research');
  ok(webAll.length >= 20, 'the rule applies to a large part of the catalogue', webAll.length);
  ok(webAll.every(j => j.asks),
     'and every one of them asks, because every one of them is about the person', 
     webAll.filter(j => !j.asks).map(j => j.id));
}

section('And the panel says so before they switch it on');
{
  const id = await page.evaluate(() => (_cwJobs().find(j => j.asks && j.asks.q) || {}).id);
  ok(!!id, 'there is a job that needs input', id);
  const r = await page.evaluate(async (jid) => {
    cwPeek(jid);
    await new Promise(x => setTimeout(x, 350));
    const p = document.querySelector('.cwp');
    const t = p ? (p.textContent || '').replace(/\s+/g, ' ').trim() : '';
    closeOvr();
    return { asks: /It will ask you for/i.test(t), why: /running on nothing/i.test(t) };
  }, id);
  ok(r.asks, 'the panel says it will ask', r);
  ok(r.why, 'and why - so the question is not a surprise on the way in', r);
}

section('And no two of them are secretly the same job');
{
  /* A duplicate id is not cosmetic: the toggle writes by id, and the lookup
     returns the first match - so switching on the second card switches on the
     first, and the person watches the wrong job start. */
  const jobs = await catalogue();
  const seen = {};
  const dupes = jobs.map(j => j.id).filter(id => (seen[id] = (seen[id] || 0) + 1) > 1);
  ok(dupes.length === 0, 'every job has its own id', dupes);
}

section('Somebody who has not paid sees the product, not a paragraph about it');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Browsing'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await new Promise(x => setTimeout(x, 1100));
  }, [EMAIL, PW]);

  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 900));
    const vc = document.getElementById('vc');
    return {
      plan: loadStr('amv_plan') || 'free',
      cards: vc.querySelectorAll('.cw-job').length,
      openable: vc.querySelectorAll('.cw-job-body[data-dact="cwPeek"]').length,
      toggles: vc.querySelectorAll('.cw-toggle').length,
      cats: vc.querySelectorAll('.cw-chip').length,
      text: (vc.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  ok(r.plan === 'free', 'they are on the free plan', r.plan);
  ok(r.cards >= 80, 'and they can see the whole catalogue', r.cards);
  ok(r.openable === r.cards, 'every card can be opened', { openable: r.openable, cards: r.cards });
  ok(r.cats >= 5, 'and browsed by category', r.cats);
  /* No switch they cannot use. A toggle that silently refuses teaches them the
     product is broken, which costs more than the sale it was protecting. */
  ok(r.toggles === 0, 'with no switch that would do nothing if they pressed it', r.toggles);
  ok(/\$\d/.test(r.text) && /plan/i.test(r.text), 'and the price is on the page', true);
}

section('Opening one shows the instruction it really runs');
{
  /* Not a summary of the instruction. The literal string that goes to the
     model - which is both the most convincing thing on the screen and the only
     version that cannot quietly drift from what happens. */
  const jobs = await catalogue();
  const j = jobs.find(x => x.sample && x.sample.length) || jobs[0];

  const r = await page.evaluate(async (id) => {
    cwPeek(id);
    await new Promise(x => setTimeout(x, 400));
    const p = document.querySelector('.cwp');
    if (!p) return { open: false };
    return {
      open: true,
      title: (p.querySelector('.cwp-t') || {}).textContent || '',
      prompt: (p.querySelector('.cwp-prompt') || {}).textContent || '',
      sampleLines: p.querySelectorAll('.cwp-line').length,
      text: (p.textContent || '').replace(/\s+/g, ' ').trim(),
      hasPlans: !!document.getElementById('cwp-plans'),
      hasGo: !!document.getElementById('cwp-go'),
    };
  }, j.id);

  ok(r.open, 'the panel opens', r);
  ok(r.title.includes(j.title.slice(0, 20)), 'showing the job they clicked', r.title);
  ok(r.prompt.trim() === j.prompt.trim(),
     'and the exact instruction, character for character, not a description of it',
     { shown: r.prompt.slice(0, 60), real: j.prompt.slice(0, 60) });
  ok(r.sampleLines >= 3, 'with a specimen of what arrives', r.sampleLines);

  /* The specimen must never be mistaken for their own data. */
  ok(/example of the shape|specifics will be yours/i.test(r.text),
     'labelled plainly as an example rather than as their result', r.text.slice(-220));

  ok(r.hasPlans && !r.hasGo,
     'and it offers the plan, since they cannot turn it on yet', { plans: r.hasPlans, go: r.hasGo });
}

section('Every job in the catalogue survives being opened');
{
  /* Opening one is fine. The question is whether the eighty-ninth is - a job
     with a missing field renders a broken panel, and nothing else would ever
     have looked at it. */
  const jobs = await catalogue();
  const bad = [];
  for (const j of jobs) {
    const r = await page.evaluate(async (id) => {
      try { cwPeek(id); } catch (e) { return { err: String(e && e.message) }; }
      const p = document.querySelector('.cwp');
      if (!p) return { err: 'did not open' };
      const t = (p.textContent || '');
      return { err: null, len: t.length, junk: /undefined|\[object Object\]|\bNaN\b/.test(t) };
    }, j.id);
    if (r.err || r.len < 200 || r.junk) bad.push(j.id + ': ' + (r.err || (r.junk ? 'placeholder value leaked' : 'too short ' + r.len)));
  }
  await page.evaluate(() => closeOvr());
  ok(bad.length === 0, 'all of them open cleanly, with nothing leaking through', bad.slice(0, 6));
}

section('It can be browsed without a mouse');
{
  const r = await page.evaluate(async () => {
    closeOvr();
    setTab('crew');
    await new Promise(x => setTimeout(x, 700));
    const btn = document.querySelector('.cw-job-body');
    btn.focus();
    const focused = document.activeElement === btn;
    btn.click();
    await new Promise(x => setTimeout(x, 400));
    const panel = document.querySelector('.cwp');
    const inPanel = !!(panel && panel.contains(document.activeElement));
    return { focused, opened: !!panel, inPanel };
  });
  ok(r.focused, 'a card takes keyboard focus', r);
  ok(r.opened, 'and opens from the keyboard', r);
  ok(r.inPanel, 'and focus moves into the panel, rather than staying behind it', r);
}

section('On a paid plan the same panel turns the job on for real');
{
  /* The other half of "the examples all work": the button in the panel has to
     start actual scheduled work on the server, not set a flag. */
  await KV.put('ent:' + EMAIL, JSON.stringify({
    plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { closeOvr(); try { await syncEntitlement(); } catch (e) {} await new Promise(x => setTimeout(x, 500)); });

  const jobs = await catalogue();
  /* One that genuinely runs unattended, so turning it on must reach the
     server rather than the local schedule. */
  const id = await page.evaluate(() => {
    const j = _cwJobs().find(x => _cwRunsUnattended(x));
    return j ? j.id : null;
  });
  ok(!!id, 'there is a job that runs with AMV closed', id);

  const before = (await KV.get('auto:' + EMAIL)) || '';
  const r = await page.evaluate(async (jid) => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 800));
    /* Turning a job on may now open the question it needs answering. Answer
       the real dialog, so this exercises the path a person actually takes. */
    const answering = setInterval(() => {
      const box = document.getElementById('modal-input');
      if (!box) return;
      box.value = 'Details for this job, typed by the person.';
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) okBtn.click();
    }, 60);
    cwPeek(jid);
    await new Promise(x => setTimeout(x, 350));
    const go = document.getElementById('cwp-go');
    const label = go ? go.textContent : '';
    const plans = !!document.getElementById('cwp-plans');
    if (go) go.click();
    await new Promise(x => setTimeout(x, 2600));
    clearInterval(answering);
    return { label, plans };
  }, id);
  await L.settle();

  ok(/turn it on/i.test(r.label), 'the panel offers to turn it on', r.label);
  ok(!r.plans, 'and no longer sells them a plan they already have', r.plans);

  const after = await KV.get('auto:' + EMAIL);
  let items = [];
  try { items = JSON.parse(after || '{}').items || []; } catch (e) {}
  ok(items.length >= 1, 'and a real background job now exists on the server', items.length);
  ok(String(after || '') !== String(before), 'which was not there before', true);
  ok(L.hit(/\/auto\/create/).length >= 1, 'created through the route the cron reads', L.hit(/\/auto\/create/).length);

  const jobData = jobs.find(x => x.id === id);
  ok(items.some(it => String(it.detail || '').slice(0, 60) === String(jobData.prompt || '').slice(0, 60)),
     'carrying the same instruction the panel showed them', String(items[0] && items[0].detail || '').slice(0, 70));
}

section('What they type reaches the job the server actually runs');
{
  /* The assertion the whole fix stands on. Asking a good question and then
     dropping the answer would be the same defect wearing a nicer coat: the
     runner still gets a preset that works from nothing, and now the person has
     been made to type for it. */
  const id = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.asks && x.asks.q && _cwRunsUnattended(x) && !x.on);
    return j ? j.id : null;
  });
  ok(!!id, 'there is a job that asks and runs unattended', id);

  const ANSWER = 'Chemistry test on the 14th, and the history essay due Friday.';
  const r = await page.evaluate(async ([jid, answer]) => {
    /* Answer the real dialog by typing into it and pressing its own button,
       so a change that broke the dialog breaks this too. */
    const watch = setInterval(() => {
      const box = document.getElementById('modal-input');
      if (!box) return;
      box.value = answer;
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) okBtn.click();
    }, 100);
    cwToggle(jid);
    await new Promise(x => setTimeout(x, 2500));
    clearInterval(watch);
    return { on: !!(_cwJobs().find(j => j.id === jid) || {}).on };
  }, [id, ANSWER]);
  await L.settle();

  ok(r.on, 'the job switched on', r);
  const rec = JSON.parse((await KV.get('auto:' + EMAIL)) || '{}');
  const made = (rec.items || []).filter(it => String(it.detail || '').includes(ANSWER));
  ok(made.length === 1, 'and what they typed is in the job the SERVER holds', made.length);
  ok(/only information you have about them/i.test(made[0].detail),
     'framed so the runner uses it and invents nothing beyond it', made[0].detail.slice(-160));
}

section('Backing out of the question creates nothing');
{
  /* A job created with the question skipped is precisely the broken one this
     fix exists to prevent, so cancelling has to mean no job - not a job that
     runs every morning on nothing. */
  const id = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.asks && x.asks.q && _cwRunsUnattended(x) && !x.on);
    return j ? j.id : null;
  });
  ok(!!id, 'another job that asks', id);

  const before = ((JSON.parse((await KV.get('auto:' + EMAIL)) || '{}')).items || []).length;
  const r = await page.evaluate(async (jid) => {
    const watch = setInterval(() => {
      const cancel = document.getElementById('modal-cancel') || document.getElementById('modal-close');
      if (cancel) cancel.click();
    }, 100);
    cwToggle(jid);
    await new Promise(x => setTimeout(x, 2000));
    clearInterval(watch);
    return { on: !!(_cwJobs().find(j => j.id === jid) || {}).on };
  }, id);
  await L.settle();

  ok(r.on === false, 'the switch stays off', r);
  const after = ((JSON.parse((await KV.get('auto:' + EMAIL)) || '{}')).items || []).length;
  ok(after === before, 'and nothing was created on the server', { before, after });
}

section('And it works on a phone, which is where it will be read');
{
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    closeOvr();
    setTab('crew');
    await new Promise(x => setTimeout(x, 800));
    const first = document.querySelector('.cw-job-body');
    const id = first ? first.dataset.darg : null;
    cwPeek(id);
    await new Promise(x => setTimeout(x, 400));
    const p = document.querySelector('.cwp');
    if (!p) return { open: false };
    const b = p.getBoundingClientRect();
    return {
      open: true,
      fits: b.left >= -1 && b.right <= window.innerWidth + 1,
      scrollable: p.scrollHeight > p.clientHeight ? true : b.height <= window.innerHeight,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      closeTappable: (() => { const x = document.getElementById('cwp-close'); if (!x) return false; const r2 = x.getBoundingClientRect(); return r2.width >= 28 && r2.height >= 28; })(),
    };
  });
  ok(r.open && r.fits, 'the panel fits a narrow screen', r);
  ok(r.scrollable, 'and scrolls inside itself rather than running off the bottom', r);
  ok(!r.sideways, 'without pushing the page sideways', r);
  ok(r.closeTappable, 'and can be closed with a thumb', r);
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors while browsing all of them', L.errors.slice(0, 4));
  const bad = L.served.filter(s => s.status >= 500);
  ok(bad.length === 0, 'and the worker never fell over', bad.map(s => s.path));
}

await L.close();
outbound.restore();
if (report('the-catalogue-sells-it') > 0) process.exitCode = 1;
done();
