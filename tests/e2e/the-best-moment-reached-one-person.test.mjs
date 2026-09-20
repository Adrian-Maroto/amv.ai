/* "MAKE SURE IT CAN DO COOL THINGS THAT PPL CAN POST TIKTOKS ABOUT."

   The impressive thing already happens, and that is the point. AMV finds four
   subscriptions somebody forgot and puts a real number on them; it reads a
   night of mail and reports that six of fifty-eight needed them; it watches a
   supplier page and catches a lead time doubling before the quote goes out.

   All of it was private. There was no way to show anyone, so the best moment
   in the product reached exactly one person, and the page that would have
   carried "Try AMV free" to their friends was never created. Nothing needed
   inventing - what was missing was a door out.

   THE PART THAT HAD TO BE GOT RIGHT, and the reason this does not simply call
   the existing share modal: that modal creates the public page the instant it
   opens. Reasonable for a chat somebody is looking at. Wrong here, because the
   whole point of Crew is that it went and READ things - a result can contain
   an inbox, a bank balance, a calendar. Publishing that before somebody has
   seen what is in it is the single worst thing this feature could do, and a
   link can be revoked while a copy cannot.

   So the assertions below are mostly about restraint: nothing is created until
   the full text has been shown and a button pressed, the warning names the
   real hazard rather than gesturing at privacy, and the text on screen is the
   text that would be published rather than a summary of it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const SECRET = 'Found 4 subscriptions you forgot. Together they cost you 631 a year.\n'
             + 'Largest: a gym membership last used 14 months ago, 44 a month.\n'
             + 'Card ending 4417 - the one on your main account.';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

/* One unread background result, shaped exactly as the runner stores one. */
await page.evaluate((out) => {
  _AUTO_RESULTS.length = 0;
  _AUTO_RESULTS.push({ id: 'r1', autoId: 'a1', detail: 'Find money I am losing every month',
                       at: Date.now() - 3600000, read: false, kind: 'task',
                       approval: 'require', outcome: 'done', costUSD: 0.004, out });
}, SECRET);

section('The result offers a way out of the account it is locked in');
{
  const r = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = _awayCardHTML();
    _wireAwayCard(host);
    const b = host.querySelector('[data-away-share]');
    return { has: !!b, label: b ? b.textContent.trim() : '', id: b ? b.dataset.awayShare : '' };
  });
  ok(r.has, 'there is a share on the result');
  ok(r.id === 'r1', 'pointing at the run it belongs to', r.id);
  ok(/found/i.test(r.label), 'and it says what it would be sharing', r.label);
}

section('Nothing is published before it has been read');
/* CONNECTED FIRST, and this matters more than it looks. The hosted share is
   only ever attempted when the app has a live backend and a session - so
   measured on a disconnected app, "no page was created" is true no matter what
   the code does, and the assertion below would pass against a version that
   publishes immediately. Measured, both ways. */
await app.connect();
{
  const r = await page.evaluate(async () => {
    let created = 0;
    const realFetch = AMV_API._fetch.bind(AMV_API);
    AMV_API._fetch = async (path, opts) => {
      if(String(path).indexOf('/v1/share/create') >= 0){
        created++;
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 'x', url: 'https://amv.test/s/x' }) };
      }
      return realFetch(path, opts);
    };
    awayShare('r1');
    await new Promise(s => setTimeout(s, 400));
    const ov = document.getElementById('ovr');
    const out = {
      created,
      warn: !!ov.querySelector('.away-share-warn'),
      warnText: (ov.querySelector('.away-share-warn') || {}).textContent || '',
      preview: (ov.querySelector('.away-share-prev-b') || {}).textContent || '',
      hasGo: !!document.getElementById('away-share-go'),
      hasLink: !!document.getElementById('share-link'),
    };
    AMV_API._fetch = realFetch;
    return out;
  });
  ok(r.created === 0, 'no public page exists yet', String(r.created));
  ok(!r.hasLink, 'and there is no link to copy, because there is nothing to link to');
  ok(r.hasGo, 'the page is created by a button, not by opening the screen');
  ok(r.warn, 'with a warning above it');
  ok(/your own accounts/.test(r.warnText),
     'that names the real hazard rather than gesturing at privacy', r.warnText.slice(0, 70));
  ok(/revoked/.test(r.warnText) && /copy/.test(r.warnText),
     'and says plainly that revoking a link does not recall a copy');
}

section('What is on screen is what would be published');
{
  const r = await page.evaluate((secret) => {
    const body = (document.querySelector('.away-share-prev-b') || {}).textContent || '';
    return {
      full: body.indexOf(secret) >= 0,
      lines: body.split('\n').length,
      /* A preview that quietly truncates is worse than none: the line it cuts
         is exactly the one somebody would have stopped at. */
      cardNumberShown: /4417/.test(body),
    };
  }, SECRET);
  ok(r.full, 'the whole result is shown, not a snippet of it');
  ok(r.lines >= 3, 'every line of it', String(r.lines));
  ok(r.cardNumberShown, 'including the last line, which is the one somebody needs to see');
}

section('Cancelling leaves nothing behind');
{
  const r = await page.evaluate(async () => {
    const no = document.getElementById('away-share-no');
    /* Reported rather than thrown: a suite that crashes says something failed,
       which is not the same as saying WHICH claim failed - and only the second
       is evidence about the thing being measured. */
    if(!no) return { noButton: true, empty: false, link: !!document.getElementById('share-link') };
    no.click();
    await new Promise(s => setTimeout(s, 200));
    const ov = document.getElementById('ovr');
    return { noButton: false, empty: !ov.querySelector('.away-share-modal'), link: !!document.getElementById('share-link') };
  });
  ok(!r.noButton, 'there is something to cancel with');
  ok(r.empty, 'the screen closes');
  ok(!r.link, 'and no link was made');
}

section('Confirming hands over to the share everything else uses');
{
  const r = await page.evaluate(async () => {
    /* Stubbed at the network seam, so what is measured is the request this
       code really makes. */
    let sent = null;
    const realFetch = AMV_API._fetch.bind(AMV_API);
    AMV_API._fetch = async (path, opts) => {
      if(String(path).indexOf('/v1/share/create') >= 0){
        sent = JSON.parse((opts && opts.body) || '{}');
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 's1', url: 'https://amv.test/s/s1' }) };
      }
      return realFetch(path, opts);
    };
    awayShare('r1');
    await new Promise(s => setTimeout(s, 300));
    const go = document.getElementById('away-share-go');
    if(!go){ AMV_API._fetch = realFetch; return { noButton: true }; }
    go.click();
    await new Promise(s => setTimeout(s, 600));
    const ov = document.getElementById('ovr');
    const listed = ov.querySelector('#share-listed');
    const out = {
      sentTitle: sent && sent.title,
      roles: sent && (sent.msgs || []).map(m => m.r),
      carriesAsk: !!(sent && (sent.msgs || []).some(m => /losing every month/.test(m.c || ''))),
      carriesResult: !!(sent && (sent.msgs || []).some(m => /631 a year/.test(m.c || ''))),
      link: (document.getElementById('share-link') || {}).value || '',
      hasListed: !!listed,
      listedOff: listed ? listed.checked === false : null,
    };
    AMV_API._fetch = realFetch;
    return out;
  });
  ok(!r.noButton, 'there is a button to confirm with');
  ok(/losing/.test(r.sentTitle || ''), 'the page is titled by what was asked for', r.sentTitle);
  ok(r.carriesAsk && r.carriesResult,
     'and carries the question as well as the answer - a result with no question is half a story',
     JSON.stringify(r.roles));
  ok(r.link.indexOf('https://') === 0, 'a real hosted link comes back', r.link);
  ok(r.hasListed, 'on the ordinary share screen, so it inherits the rest');
  ok(r.listedOff === true, 'with search engines off by default, as everywhere else');
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
