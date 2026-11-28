/* EVERY JOB CONNECTS ON ONE CENTRED PAGE (Nov 28, the owner: "it should be
   centred and look aesthetic for all connectors. I am sure this bug shows for
   almost every job, every country, every section").

   The owner was right that it was not one job. Walking every kind of need a
   job can have found four different screens and three dead ends:
   - a job needing nothing said "This needs Nothing before it can run" with a
     Connect button under it (four jobs);
   - the job hunt profile and web automation were treated as connectors and
     sent people to a directory search that found nothing;
   - on a job needing a mailbox AND a calendar, the calendar's Connect opened
     the mailbox choices, because the next screen always took the first need;
   - the list of needs, a mailbox's form and the bank link were each a
     different, left-aligned popup.

   So this walks EVERY job Crew can show - the built-in ones, the everyday
   fifty and the made-for jobs of several countries, and a spread of each
   country's catalogue - presses its Connect, and holds each screen to the
   same page: centred on the window, a title, every row with Connect or a
   tick, and none of the dead ends above. Then it walks the routes between
   the pages, on a laptop and on a phone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const COUNTRIES = ['US', 'DE', 'JP', 'BR', 'IN', 'ES'];

for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: h }, hasTouch: phone, user: { name: 'Maya', email: 'maya@x.com', ini: 'M' } });
  const { page, errors } = app;
  const tag = phone ? 'phone' : 'laptop';

  await page.evaluate(() => {
    saveStr('amv_plan', 'pro');
    AMV_API.base = 'https://stub.amv.dev';
    AMV_API.token = 'test-token';
    AMV_API.connectList = async () => ({ configured: true, items: [], providers: [
      { id: 'google', name: 'Google', ready: true, scopes: ['mail.read', 'calendar.read', 'drive.read', 'school.read'] },
      { id: 'microsoft', name: 'Microsoft', ready: true, scopes: ['mail.read', 'calendar.read'] } ] });
    AMV_API.mailProviders = async () => ({ countries: 24, providers: [
      { id: 'icloud', name: 'iCloud Mail', country: 'US', flag: '🇺🇸', setup: 'Make an app-specific password at appleid.apple.com.' },
      { id: 'yahoo', name: 'Yahoo Mail', country: 'US', flag: '🇺🇸', setup: 'Generate an app password in Account Security.' },
      { id: 'webde', name: 'WEB.DE', country: 'DE', flag: '🇩🇪', setup: 'Turn on IMAP in WEB.DE settings.' },
      { id: 'custom', name: 'Any other provider', country: '', flag: '🌍', custom: true, setup: 'Your provider publishes these.' } ] });
    try { _MAILP = null; } catch (e) {}
  });

  section(tag + ': every job, every country - Connect opens the one centred page');
  const sweep = await page.evaluate(async (countries) => {
    await _loadCrewData();
    const pause = (ms) => new Promise(r => setTimeout(r, ms));
    const seen = new Set(), jobs = [];
    const add = (list, from) => (list || []).forEach(j => { if (j && j.id && !seen.has(j.id)) { seen.add(j.id); jobs.push({ id: j.id, from }); } });
    add(_cwJobs(), 'built-in');
    add(_cwUniversalJobs(), 'everyday');
    for (const cc of countries) {
      _cwSetCountry(cc);
      /* By name, not _cwAllJobs(): once a country's catalogue has loaded that
         includes all of it - 22,000 jobs for the United States. */
      add(_cwLocalJobs(cc), cc); add(_cwTopTen(cc), cc + ' top'); add(_cwMadeForJobs(cc), cc + ' made-for');
      let cat = []; try { cat = await ccCrewLoad(cc); } catch (e) {}
      /* A spread of the catalogue, plus every one that needs more than the web. */
      const step = Math.max(1, Math.floor((cat || []).length / 25));
      add((cat || []).filter((j, i) => i % step === 0 || String(j.needs || '') !== 'Web research'), cc + ' catalogue');
    }
    const bad = [], kinds = {};
    const mid = innerWidth / 2;
    for (const { id, from } of jobs) {
      try { closeOvr(); } catch (e) {}
      const tabBefore = S.tab;
      try { cwConnect(id); } catch (e) { bad.push({ id, from, threw: String(e.message || e) }); continue; }
      for (let i = 0; i < 40 && !document.querySelector('#ovr .cwc .cwc-t'); i++) await pause(10);
      const o = document.getElementById('ovr');
      const pg = o && o.querySelector('.cwc.cwk');
      const t = pg && pg.querySelector('.cwc-t');
      const text = (o && o.innerText || '').replace(/\s+/g, ' ');
      const kind = !pg ? 'none' : pg.classList.contains('bank-dlg') ? 'bank' : pg.classList.contains('ml-page') ? 'mail'
        : pg.classList.contains('jh-page') ? 'profile' : pg.classList.contains('cwn') ? 'list' : 'ways';
      kinds[kind] = (kinds[kind] || 0) + 1;
      const tr = t && t.getBoundingClientRect();
      const rows = pg ? [...pg.querySelectorAll('.cwk-row')] : [];
      const dead = rows.filter(r => !r.querySelector('button') && !r.querySelector('.cwn-ok'));
      const why = [];
      if (!pg) why.push('no centred page');
      if (S.tab !== tabBefore) why.push('left for ' + S.tab);
      if (tr && Math.abs(tr.left + tr.width / 2 - mid) > 2) why.push('title off-centre by ' + Math.round(tr.left + tr.width / 2 - mid));
      if (/cannot hold an account key|needs Nothing/.test(text) || rows.some(r => /^Nothing$/.test(((r.querySelector('.cwk-n') || {}).textContent || '').trim()))) why.push('dead-end wording');
      if (dead.length) why.push(dead.length + ' row(s) with no Connect and no tick');
      if (kind === 'ways' && !rows.some(r => r.querySelector('[data-cwk]'))) why.push('no ways offered');
      if (pg && pg.scrollWidth > pg.clientWidth + 1) why.push('wider than the screen');
      if (why.length) bad.push({ id, from, kind, why, text: text.slice(0, 90) });
    }
    try { closeOvr(); } catch (e) {}
    return { n: jobs.length, bad: bad.slice(0, 8), badN: bad.length, kinds };
  }, COUNTRIES);
  ok(sweep.n > 250, 'the sweep reached the built-in jobs and several countries’ jobs', sweep.n);
  ok(sweep.badN === 0, 'every one of them opened the centred page with nothing dead on it', sweep);
  ok(['list', 'ways', 'bank', 'profile'].every(k => sweep.kinds[k] > 0), 'and every kind of page was among them', sweep.kinds);

  section(tag + ': the need that was pressed is the one connected');
  {
    const r = await page.evaluate(async () => {
      closeOvr(); cwNeeds('forgot_check'); await new Promise(x => setTimeout(x, 150));
      const needs = [...document.querySelectorAll('.cwn-go')].map(b => b.dataset.cwnNeed);
      document.querySelectorAll('.cwn-go')[needs.indexOf('Calendar')].click();
      await new Promise(x => setTimeout(x, 150));
      const title = (document.querySelector('#ovr .cwc-t') || {}).textContent || '';
      const ways = [...document.querySelectorAll('#ovr .cwk-row .cwk-n')].map(e => e.textContent);
      const back = document.getElementById('cwk-back'); if (back) back.click();
      await new Promise(x => setTimeout(x, 150));
      return { needs, title, ways, backToList: !!document.getElementById('cwn-back') };
    });
    ok(/calendar/i.test(r.title) && r.ways.every(n => /Calendar/.test(n)), 'Connect on Calendar offers calendars, not mailboxes', r);
    ok(r.backToList, 'and Back returns to the list of what the job needs', r.backToList);
  }

  section(tag + ': a mailbox read by app password is the next page, not a popup');
  {
    const r = await page.evaluate(async () => {
      closeOvr(); openCrewConnect('inbox_digest'); await new Promise(x => setTimeout(x, 150));
      const rows = [...document.querySelectorAll('#ovr .cwk-row')];
      const row = (n) => rows.find(e => (e.querySelector('.cwk-n') || {}).textContent === n);
      row('iCloud Mail').querySelector('button').click();
      await new Promise(x => setTimeout(x, 250));
      const pg = document.querySelector('#ovr .cwc.ml-page'), t = pg && pg.querySelector('.cwc-t').getBoundingClientRect();
      const out = { page: !!pg, title: pg && pg.querySelector('.cwc-t').textContent, prov: (document.getElementById('ml-prov') || {}).value,
                    centre: t ? Math.round(t.left + t.width / 2 - innerWidth / 2) : null,
                    password: !!document.querySelector('#ml-pass[type=password]') };
      document.getElementById('ml-cancel').click(); await new Promise(x => setTimeout(x, 150));
      out.backToWays = !!document.querySelector('#ovr [data-cwk]');
      const rows2 = [...document.querySelectorAll('#ovr .cwk-row')];
      rows2[rows2.length - 1].querySelector('button').click();
      await new Promise(x => setTimeout(x, 250));
      out.other = { prov: (document.getElementById('ml-prov') || {}).value, imap: (document.getElementById('ml-custom') || { style: {} }).style.display !== 'none' };
      closeOvr();
      return out;
    });
    ok(r.page && r.title === 'Connect iCloud Mail' && r.prov === 'icloud', 'iCloud Mail opens its own form, titled with it and already chosen', r);
    ok(Math.abs(r.centre) <= 2, 'centred like the page before it', r.centre);
    ok(r.password, 'asking for an app password in a password field', r.password);
    ok(r.backToWays, 'and Back returns to the mailbox choices', r.backToWays);
    ok(r.other.prov === 'custom' && r.other.imap, '“Another email account” starts on entering the server yourself', r.other);
  }

  section(tag + ': the profile, a bank and the jobs that need nothing');
  {
    const r = await page.evaluate(async () => {
      const read = () => ({ tab: S.tab, page: [...(document.querySelector('#ovr .cwc') || { classList: [] }).classList].join(' '),
                            text: ((document.getElementById('ovr') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 160) });
      /* No job left waiting to be resumed by the sweep above, or arriving on
         Crew would reopen it on top of what this presses. */
      _cwResumeJob(''); closeOvr(); setTab('crew'); await new Promise(x => setTimeout(x, 700));
      cwConnect('job_hunt'); await new Promise(x => setTimeout(x, 200));
      const hunt = read();
      const back = document.getElementById('jh-cancel'); if (back) back.click();
      await new Promise(x => setTimeout(x, 200));
      hunt.backToJob = !!document.querySelector('#ovr .cwp');
      closeOvr(); cwConnect('money_morning'); await new Promise(x => setTimeout(x, 300));
      const bank = read(); bank.back = !!document.getElementById('bank-back');
      closeOvr(); cwConnect('friday_game'); await new Promise(x => setTimeout(x, 150));
      const nothing = read(); nothing.rows = document.querySelectorAll('#ovr .cwn-row').length;
      nothing.run = !!document.getElementById('cwn-on');
      closeOvr(); cwNeeds('target_buy'); await new Promise(x => setTimeout(x, 150));
      const browser = read(); browser.connect = document.querySelectorAll('#ovr .cwn-go').length; browser.run = !!document.getElementById('cwn-on');
      closeOvr();
      return { hunt, bank, nothing, browser };
    });
    ok(r.hunt.tab === 'crew' && /jh-page/.test(r.hunt.page) && /For “Job hunt/.test(r.hunt.text),
       'the job hunt profile opens as its own page for that job, not a connector search', r.hunt);
    ok(r.hunt.backToJob, 'and Back to the job returns to the job', r.hunt.backToJob);
    ok(/bank-dlg/.test(r.bank.page) && /For “Morning money summary”/.test(r.bank.text) && r.bank.back,
       'a bank links on the same page, naming the job, with Back to it', r.bank);
    ok(r.nothing.rows === 0 && r.nothing.run && !/Nothing/.test(r.nothing.text), 'a job needing nothing has nothing to connect, and Run', r.nothing);
    ok(r.browser.connect === 0 && r.browser.run, 'AMV’s own browser is built in: no Connect, and Run', r.browser);
  }

  ok(errors.length === 0, tag + ': no page errors', errors.slice(0, 3));
  await app.close();
}

process.exit(report() === 0 ? (done(), 0) : 1);
