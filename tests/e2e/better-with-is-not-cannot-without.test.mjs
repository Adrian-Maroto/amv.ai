/* "IT READS YOUR RECEIPTS AND STATEMENTS" - AND IT COULD ONLY READ RECEIPTS.

   The money leak detector's description said both, and only one was true. A
   receipt is what a merchant SAID it would charge; a debit is what LEFT THE
   ACCOUNT. They differ in exactly the case the job is named for - a price that
   went up quietly is invisible in receipts until the next one arrives, and
   visible on a statement the same month.

   The runner can read a statement now. That created a requirement this
   codebase's needs model could not express, and getting it wrong would have
   been worse than leaving it alone:

     - Put the bank in `needs` and every card outside the aggregator's handful
       of countries reads "a bank connection is missing" for a job that works
       perfectly on receipts, refuses to say ready, refuses to run with AMV
       closed, and sends the person after an account they cannot get.
     - Leave it out entirely and the job keeps calling a merchant's
       announcement a statement, which is the sentence that was wrong in the
       first place.

   So `boost` says it: a source that makes the answer better and is not
   required to produce one. The whole risk of the idea is that it looks exactly
   like `needs` one function along, so this file's job is to prove the two never
   touch - a boost must never reach the missing list, never hold back the green
   flag, never decide where the job runs, and must still be NAMED before
   somebody switches the job on. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

/* Grants are loaded the way the app loads them - through the API seam and
   `_connLoad`, never by writing `window._connState`, which is a script binding
   and would set something nothing reads. */
const grant = caps => page.evaluate(async cs => {
  AMV_API.base = 'https://amv-stub.workers.dev';
  AMV_API.token = 'test-token';
  AMV_API.connectList = async () => ({ items: cs.length
    ? [{ unattended: true, broken: false, scopes: cs, providerName: 'Outlook' }] : [] });
  await _connLoad(true);
}, caps);

/* And the bank through the one accessor the product asks, so this measures the
   same answer every other screen gets. */
const bank = on => page.evaluate(v => { saveStr('amv_fin_linked', v ? '1' : ''); }, on);

const LEAKS = { id: 'money_leaks', needs: 'Email', boost: 'Bank connection' };

section('A boost is never in the missing list');
{
  await grant(['mail.read']);
  await bank(false);
  const r = await page.evaluate(j => ({
    missing: _cwNeedsMissing(j),
    ready: _cwNeedsReady(j),
    readyLine: _cwReadyLine(j),
    boosts: _cwBoostList(j),
    boostMissing: _cwBoostMissing(j),
  }), LEAKS);
  ok(r.missing.length === 0,
     'with the mailbox connected and no bank, NOTHING is missing - the job works on receipts and always did',
     JSON.stringify(r.missing));
  ok(r.ready === true,
     'so it earns the green flag, rather than telling most of the world a working job is broken',
     String(r.ready));
  ok(!/bank/i.test(r.readyLine),
     'and the ready line names what was connected, not what was not', r.readyLine);
  ok(r.boosts.length === 1 && /bank/i.test(r.boosts[0]),
     'the bank is still named, separately, so it is not a secret', JSON.stringify(r.boosts));
  ok(r.boostMissing.length === 1,
     'and it is reported as absent on its own list', JSON.stringify(r.boostMissing));
}

section('A boost does not decide where the job runs');
{
  await grant(['mail.read']);
  await bank(false);
  const r = await page.evaluate(j => ({
    where: _cwWhereState(j), label: _cwWhereLabel(j), uses: _cwUsesFor(j), boosts: _cwBoostsFor(j),
  }), LEAKS);
  ok(r.where === 'closed',
     'a mailbox is connected, so it runs with AMV closed - an optional bank must not drag it back into the browser',
     r.where);
  ok(/closed/i.test(r.label), 'and the card says so', r.label);
  ok(r.uses.length === 1 && r.uses[0] === 'mail.read',
     'the required list carries only what is required', JSON.stringify(r.uses));
  ok(r.boosts.length === 1 && r.boosts[0] === 'bank.read',
     'and the boost rides in its own field, which the server refuses the same way and reports differently',
     JSON.stringify(r.boosts));
}

section('When the bank IS there, the row says the figures are real');
{
  await grant(['mail.read']);
  await bank(true);
  const r = await page.evaluate(j => ({
    boostMissing: _cwBoostMissing(j), missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j),
  }), LEAKS);
  ok(r.boostMissing.length === 0, 'nothing to note', JSON.stringify(r.boostMissing));
  ok(r.missing.length === 0 && r.ready === true, 'and the job is still ready', JSON.stringify(r));
}

section('The card says which way it is, before anybody switches it on');
{
  await grant(['mail.read']);
  await bank(false);
  await page.evaluate(() => cwPeek('money_leaks'));
  await page.waitForTimeout(150);
  const seen = await page.evaluate(() => {
    const t = (document.getElementById('ovr') || {}).textContent || '';
    return { t, has: /Better with/i.test(t) };
  });
  ok(seen.has, 'the detail carries a "Better with" row', seen.t.slice(0, 200));
  ok(/runs on what it can read/i.test(seen.t),
     'and says what happens without it, rather than leaving the reader to guess at what changes', true);
  /* The row that means STOP looks different and has a button. This one must
     not be mistaken for it. */
  ok(!/Connect a bank/i.test(seen.t),
     'with no Connect button attached to it, because there is nothing to unblock', true);

  await bank(true);
  await page.evaluate(() => { try{ closeOvr(); }catch(e){} });
  await page.waitForTimeout(80);
  await page.evaluate(() => cwPeek('money_leaks'));
  await page.waitForTimeout(150);
  const linked = await page.evaluate(() => (document.getElementById('ovr') || {}).textContent || '');
  ok(/figures are real charges/i.test(linked),
     'and with a bank linked the same row says the figures are real charges', linked.slice(0, 200));
}

section('A missing REQUIREMENT still stops the job, boost or no boost');
{
  await grant([]);
  await bank(false);
  const r = await page.evaluate(j => ({
    missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j), where: _cwWhereState(j),
  }), LEAKS);
  ok(r.missing.length === 1 && /mailbox/i.test(r.missing[0]),
     'no mailbox is a real blocker and is named as one', JSON.stringify(r.missing));
  ok(r.ready === false, 'and there is no green flag', String(r.ready));
  ok(r.where !== 'closed', 'and it does not claim to run with AMV closed', r.where);
}

section('The five jobs that asked for a bank now ask the server for one');
{
  /* This is the defect, not a nicety. Each of these declares
     needs:'Bank connection' and each prompt is written around real balances or
     real transactions. With no row in `_CW_NEEDS_TO_USES`, `uses` came back
     empty, the server opened nothing, and the job ran every morning on its
     instruction alone. */
  await grant([]);
  const r = await page.evaluate(() => {
    const ids = ['money_morning', 'unusual_spend', 'low_balance', 'credit_watch', 'budget_trend'];
    const all = _cwAllJobs() || [];
    return ids.map(id => {
      const j = all.find(x => x.id === id);
      return { id, found: !!j, needs: j && j.needs, uses: j ? _cwUsesFor(j) : null };
    });
  });
  for (const j of r) {
    ok(j.found, j.id + ' is in the catalogue', JSON.stringify(j));
    ok(Array.isArray(j.uses) && j.uses.includes('bank.read'),
       j.id + ' asks the server for bank.read, so the runner opens something', JSON.stringify(j));
  }
}

section('With no bank linked, those jobs say so instead of running on nothing');
{
  await grant([]);
  await bank(false);
  const r = await page.evaluate(() => {
    const j = (_cwAllJobs() || []).find(x => x.id === 'money_morning');
    return { missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j), where: _cwWhereState(j) };
  });
  ok(r.missing.length === 1 && /bank/i.test(r.missing[0]),
     'the bank is a REQUIREMENT for these - it is the whole input, not an improvement', JSON.stringify(r.missing));
  ok(r.ready === false, 'so no green flag', String(r.ready));

  await bank(true);
  const on = await page.evaluate(() => {
    const j = (_cwAllJobs() || []).find(x => x.id === 'money_morning');
    return { missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j), where: _cwWhereState(j),
             line: _cwReadyLine(j) };
  });
  ok(on.missing.length === 0 && on.ready === true, 'linked, and it is ready', JSON.stringify(on));
  ok(on.where === 'closed',
     'and it runs with AMV closed now, which it could not before - the runner holds the capability',
     on.where);
  ok(/ready to run/i.test(on.line), 'and says so in the words a person reads', on.line);
}

/* ─────────────────────────────────────────────────────────────────────────
   A VALUE COMPUTED IS NOT A VALUE SENT.

   This section exists because of what deleting `boosts: _cwBoostsFor(j)` from
   the Crew screen proved: every assertion above still passed. `_cwBoostsFor`
   was right, the card was right, and `_scheduleTask` - which writes its
   outbound payload out field by field - named `uses` and not `boosts`, so the
   value was dropped one function short of the wire. The card said "Better with
   a bank connection", the server was told nothing, and the run stood on
   receipts.

   So the claim measured here is the only one that matters: what actually leaves
   the browser when somebody switches the job on.
   ───────────────────────────────────────────────────────────────────────── */
section('What leaves the browser carries the boost');
{
  await grant(['mail.read']);
  await bank(true);
  await app.connect();
  /* Every request answered in-page, and the one we care about recorded. This
     is the whole chain: the toggle, the payload builder, and the POST. */
  await app.stubFetch((u, o) => {
    window.__sent = window.__sent || [];
    if (/\/auto\/create/.test(u)) {
      let body = {}; try { body = JSON.parse((o && o.body) || '{}'); } catch (e) {}
      window.__sent.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, emailReady: false,
        item: { id: 'a1', detail: body.detail, uses: body.uses, boosts: body.boosts, notify: 'app' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  /* THE REAL TOGGLE, ON THE REAL CATALOGUE ENTRY.

     Calling `_scheduleTask` with a payload the TEST assembles proves only that
     `_scheduleTask` forwards what it is handed - and the first version of this
     section did exactly that, which is why deleting `boosts` from the Crew
     screen still passed. The chain has two joints and both have now been cut
     in a mutation, so both are driven here: `_cwToggleReal` builds the payload
     off the catalogue entry, `_scheduleTask` puts it on the wire. */
  const sent = await page.evaluate(async () => {
    window.__sent = [];
    const jobs = _cwAllJobs() || [];
    const j = jobs.find(x => x.id === 'money_leaks');
    j.on = false;
    await _cwToggleReal(jobs, j);
    return window.__sent;
  });

  ok(sent.length === 1, 'switching the job on posts it', JSON.stringify(sent));
  ok(Array.isArray(sent[0].uses) && sent[0].uses.includes('mail.read'),
     'the required capability is on the wire', JSON.stringify(sent[0].uses));
  ok(Array.isArray(sent[0].boosts) && sent[0].boosts.includes('bank.read'),
     'AND SO IS THE BOOST - this is the assertion that was missing while the field was being dropped',
     JSON.stringify(sent[0]));
  ok(sent[0].srcId === 'money_leaks', 'against the catalogue entry it came from', sent[0].srcId);
}

section('A bank is not an OAuth grant, and must not be offered as one');
{
  /* A REGRESSION THIS WORK SHIPPED AND `crew-jobs` CAUGHT.

     `cap` was added to the 'Bank connection' row so it would look like its
     neighbours. `_cwMissingNeeds` keys on exactly that field to mean "a
     connector could supply this", so the row acquiring one sent every bank job
     to `openCrewConnect` - a screen that can offer a provider sign-in and has
     no provider to offer for a bank, so its only honest answer was "there is
     nothing to connect". The sentence it replaced was true and better.

     The comment above `_cwMissingNeeds` said all of this already. Asserted
     here rather than left as prose, because a comment explaining why something
     is safe is a test plan somebody has to actually run. */
  await grant([]);
  await bank(false);
  const r = await page.evaluate(() => {
    const row = CW_NEEDS_CHECK['Bank connection'];
    const j = (_cwAllJobs() || []).find(x => x.id === 'money_morning');
    return { cap: row.cap, has: row.has(), offerable: _cwMissingNeeds(j).map(x => x.need),
             missing: _cwNeedsMissing(j) };
  });
  ok(!r.cap, 'the row declares no capability a connector screen could act on', String(r.cap));
  ok(r.has === false, 'while still answering "is one linked" correctly', String(r.has));
  ok(r.offerable.length === 0,
     'so a bank job is never routed to a connect screen with nothing on it', JSON.stringify(r.offerable));
  ok(r.missing.length === 1 && /bank/i.test(r.missing[0]),
     'and the requirement is still reported, by name, in the sentence that can actually say it',
     JSON.stringify(r.missing));
}

section('The description no longer claims a statement it cannot read');
{
  const r = await page.evaluate(() => {
    const j = (_cwAllJobs() || []).find(x => x.id === 'money_leaks');
    return { desc: j.desc, prompt: j.prompt, boost: j.boost };
  });
  ok(r.boost === 'Bank connection', 'the job declares the bank as a boost', r.boost);
  ok(/where a bank is linked/i.test(r.desc),
     'and the description says the statement is conditional rather than promising one outright', r.desc);
  ok(/receipt/i.test(r.prompt) && /statement/i.test(r.prompt),
     'while the instruction makes the run say which figures came from which', r.prompt.slice(0, 200));
}

ok(errors.length === 0, 'and nothing threw along the way', JSON.stringify(errors.slice(0, 3)));
await app.close();
report();
done();
