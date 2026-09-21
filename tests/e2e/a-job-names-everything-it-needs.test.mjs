/* "IT SAYS GMAIL FOR ALMOST ALL OF CREW WHEN IT SHOULD SAY BANK ACCOUNT, OR
   XYZ. AND IF IT NEEDS MULTIPLE IT SHOULD SAY ALL OF THEM. AND IF IT IS
   ALREADY CONNECTED IT SHOULD SAY ALL CONNECTED, READY TO GO."

   Three defects behind one sentence, and the worst of them was invisible.

   1. AN UNKNOWN REQUIREMENT READ AS A MET ONE. The checker looked its name up
      in a table of five - Email, Calendar, Drive, Classroom, a bank link - and
      SKIPPED anything it did not find. So a job needing WhatsApp, M-Pesa, UPI,
      Line, Vinted or Mercado Libre reported nothing missing and offered itself
      as ready. It would have switched on, found nothing, and told the person
      afterwards about a requirement nobody had mentioned. That also made the
      catalogue unsafe to extend, which is why it had not been: adding a
      service would have manufactured false ready states across the grid.

      It fails CLOSED now. An unrecognised name is listed as missing, by its
      own name, so the data can only ever ask for too much - never too little.

   2. THE LABEL SAID GMAIL WHEN THE CAPABILITY IS A MAILBOX. The server grants
      mail.read from Google OR Microsoft and has all along, so naming one of
      them was wrong before AMV left the United States and is worse now:
      telling somebody in Jakarta to connect Gmail for a job that wants their
      Outlook account sends them after an account they may not have.

   3. NOTHING MISSING LOOKED LIKE NOTHING AT ALL. A blank space meant both "you
      have already connected everything this needs" and "this needs something
      nobody checked". A person who has done the work should be told. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

/* THE GRANTS ARE LOADED THE WAY THE APP LOADS THEM.

   `_connState` is a top-level `let`, so it is a script binding and never a
   property of window - writing `window._connState` sets something nothing
   reads, and every assertion below then measures an account with no grants
   while claiming to measure one with grants. That is the trap this repository
   has a whole gate stage for, and the first version of this file walked into
   it. So the connector list is stubbed at the API seam and `_connLoad(true)`
   is called, which is the path the product itself takes. */
const grant = caps => page.evaluate(async cs => {
  AMV_API.base = 'https://amv-stub.workers.dev';
  AMV_API.token = 'test-token';
  AMV_API.connectList = async () => ({ items: cs.length
    ? [{ unattended: true, broken: false, scopes: cs, providerName: 'Outlook' }] : [] });
  await _connLoad(true);
}, caps);

section('A requirement nobody recognises is not a requirement that is met');
{
  await grant([]);
  const r = await page.evaluate(() => {
    const j = { id: 'x', needs: 'Depop, M-Pesa, WhatsApp' };
    return { missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j), anything: _cwNeedsAnything(j) };
  });
  ok(r.missing.length === 3, 'all three unknown services are reported missing', JSON.stringify(r.missing));
  ok(r.missing.includes('M-Pesa'), 'each by its own name, not swallowed', JSON.stringify(r.missing));
  ok(!r.ready, 'and the job is not offered as ready', String(r.ready));
  ok(r.anything, 'it does count as needing something', String(r.anything));
}

section('Web research is a capability of the runner, not an account');
{
  await grant([]);
  const r = await page.evaluate(() => {
    const j = { id: 'w', needs: 'Web research' };
    return { missing: _cwNeedsMissing(j), anything: _cwNeedsAnything(j), ready: _cwNeedsReady(j) };
  });
  ok(r.missing.length === 0, 'nobody is asked to connect the web', JSON.stringify(r.missing));
  /* And a job that needs nothing from the person is NOT "ready because you
     connected things" - it simply never needed them, so it makes no claim. */
  ok(!r.anything, 'a web-only job declares no account at all');
  ok(!r.ready, 'so it does not announce itself as connected');
}

section('Every missing thing is named, not just the first');
{
  await grant(['calendar.read']);
  const r = await page.evaluate(() => {
    const j = { id: 'm', needs: 'Email, Calendar, Drive, Bank connection' };
    return { missing: _cwNeedsMissing(j), card: _cwJobCard(Object.assign({ title:'T', desc:'D', icon:'x', on:false }, j)) };
  });
  ok(r.missing.length === 3, 'the three it has not got are listed', JSON.stringify(r.missing));
  ok(!r.missing.includes('a calendar'), 'and the one it has is not', JSON.stringify(r.missing));
  ok(/Needs 3 things/.test(r.card), 'the card leads with how many', r.card.slice(0, 120));
  r.missing.forEach(m => ok(r.card.indexOf(m) > 0, 'the card names ' + m));
}

section('The label is the capability, not Gmail');
{
  await grant([]);
  const r = await page.evaluate(() => _cwNeedsMissing({ id: 'e', needs: 'Email, Calendar, Drive, Classroom' }));
  ok(!r.some(x => /gmail|google/i.test(x)),
     'no requirement names a US provider the person may not use', JSON.stringify(r));
  ok(r.includes('a mailbox'), 'a mailbox is what the job actually needs', JSON.stringify(r));
}

section('When it is all there, the card says so');
{
  await grant(['mail.read', 'calendar.read']);
  const r = await page.evaluate(() => {
    const j = { id: 'r', title: 'Daily digest', desc: 'D', icon: 'x', on: false, needs: 'Email, Calendar' };
    return { missing: _cwNeedsMissing(j), ready: _cwNeedsReady(j), card: _cwJobCard(j) };
  });
  ok(r.missing.length === 0, 'nothing is missing', JSON.stringify(r.missing));
  ok(r.ready, 'so the job is ready');
  /* Named back to them: they connected Outlook, so the card says Outlook
     rather than a category they have to translate. */
  ok(/ready to run/.test(r.card), 'and the card says it out loud', r.card.slice(-220));
  ok(/Outlook/.test(r.card), 'naming what they actually connected', r.card.slice(-220));
  ok(/cw-job-ready/.test(r.card), 'on its own treatment rather than as a blank space');
}

section('A connected provider is named by the name they chose');
{
  await grant(['mail.read']);
  const who = await page.evaluate(() => _cwProviderNameFor('mail.read'));
  ok(who === 'Outlook', 'the provider they actually connected is what AMV can name', who);
  await grant([]);
  const none = await page.evaluate(() => _cwProviderNameFor('mail.read'));
  ok(none === '', 'and with nothing connected AMV does not pick one for them', JSON.stringify(none));
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
