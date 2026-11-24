/* TASKS KNOW WHERE YOU ARE (Nov 15, owner: "remove Only on AMV, remove the
   advice / find out / writing sections - all of that - and only keep 'For
   Spain', the tasks naming real services there, without 'Source: Wikidata'.
   For all countries: show all of them, with a search bar, organized - and at
   the top, 'not in this country' so you can choose yours. Make sure AMV can
   access location.").

   What is held: the page is the country's own tasks and nothing else; every
   one of them is reachable (a category's See all, Show more, search); the
   country can be changed from the top, by hand or from the device's position -
   resolved on the device, the coordinates sent nowhere; pressing a task writes
   a prompt that names the service, in chat; nothing found offers chat with the
   words carried across. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 } });
const { page, errors } = app;
const sent = [];
page.on('request', r => sent.push(r.url() + ' ' + (r.postData() || '')));
const openTasks = async (cc) => {
  await page.evaluate((c) => { _cwSetCountry(c); setTab('tasks'); }, cc);
  /* Each category heads its list with how many examples it holds; the chips
     carry no counts (Nov 24: the lists are examples, not everything AMV does). */
  await page.waitForFunction(() => document.querySelector('#tk2-body .tk2-cat-h span, #tk2-body .tk-row, #tk-none-go'), null, { timeout: 15000 });
  await page.waitForTimeout(200);
};

section('Only the country’s own tasks');
{
  await openTasks('ES');
  const r = await page.evaluate(() => ({ h: document.querySelector('.tk2-h h1').textContent, sub: String([...document.querySelectorAll('#tk2-body .tk2-cat-h span')].reduce((s, e) => s + (+e.textContent.replace(/[^\d]/g, '') || 0), 0)), line: document.getElementById('tk2-sub'),
    text: document.querySelector('.tk2').textContent, cats: [...document.querySelectorAll('.tk2-cat-h h2')].map(h => h.textContent),
    uniq: document.querySelectorAll('.uniq-card').length, general: document.querySelectorAll('[data-darg^="x-"], .tasks-masonry').length }));
  ok(/Spain/.test(r.h), 'headed for Spain', r.h);
  const n = +r.sub.replace(/[^\d]/g, '');
  ok(n >= 1000, 'with the count of what is really there, by category - ' + n, r.sub);
  ok(r.uniq === 0 && !/Only on AMV/.test(r.text), 'no "Only on AMV"', r.uniq);
  ok(r.general === 0 && !/Advice & how-to|Find out/.test(r.text), 'no general advice, find-out or writing groups', r.general);
  ok(!/Wikidata/.test(r.text), 'and no "Source: Wikidata"', '');
  ok(r.cats.length >= 6 && r.cats.includes('Money'), 'organized under categories', r.cats);
}

section('Every one of them can be reached');
{
  const before = await page.evaluate(() => document.querySelectorAll('#tk2-body .tk-row').length);
  await page.click('.tk2-all');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ rows: document.querySelectorAll('#tk2-body .tk-row').length, on: (document.querySelector('#tk2-cats .cj-chip.on') || {}).textContent || '',
    more: !!document.getElementById('tk-more') }));
  ok(r.rows > 6 && r.on && !/^All/.test(r.on), 'a category’s See all opens the whole category', r);
  await page.evaluate(() => document.querySelector('#tk2-cats [data-tkcat="all"]').click());
  await page.waitForTimeout(150);
  ok(before > 0, 'All shows the first few of each', before);
}

section('A task opens chat, naming the service');
{
  const want = await page.evaluate(() => { const b = document.querySelector('#tk2-body .tk-row'); const s = b.querySelector('.tk-d').textContent; b.click(); return s; });
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && v.val.indexOf(want) >= 0, 'the prompt is in chat and names ' + want, v.val.slice(0, 100));
}

section('Search, and nothing found goes to chat');
{
  await openTasks('ES');
  await page.fill('#tk-find', 'renfe');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => [...document.querySelectorAll('#tk2-body .tk-row')].map(b => b.textContent.toLowerCase()));
  ok(r.length >= 1 && r.every(t => t.indexOf('renfe') >= 0), 'only matching tasks are left', r.slice(0, 3));
  await page.fill('#tk-find', 'renew my fishing licence on the moon');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!document.getElementById('tk-none-go')), 'no match: an offer to ask in chat');
  await page.click('#tk-none-go');
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && v.val === 'renew my fishing licence on the moon', 'carrying the words across', v);
}

section('Not in Spain? Choose, by hand or by where you are');
{
  await openTasks('ES');
  await page.click('[data-dact="tkCountry"]');
  await page.waitForSelector('#ccp-list');
  await page.fill('#ccp-q', 'united states');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /United States/.test((document.querySelector('.tk2-h h1') || {}).textContent || ''), null, { timeout: 15000 });
  ok(true, 'choosing the United States redraws Tasks for it');
  /* A position in Madrid, given by the browser - resolved here, sent nowhere. */
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 40.4168, longitude: -3.7038 });
  sent.length = 0;
  await page.click('[data-dact="tkCountry"]');
  await page.waitForSelector('#ccp-loc');
  await page.click('#ccp-loc');
  await page.waitForFunction(() => /Spain/.test((document.querySelector('.tk2-h h1') || {}).textContent || ''), null, { timeout: 15000 });
  ok(true, 'Use my location chooses Spain for a position in Madrid');
  ok(!sent.some(u => /40\.41|-3\.70/.test(u)), 'and the coordinates were sent nowhere', sent.filter(u => /40\.41|-3\.70/.test(u)).slice(0, 2));
  /* Lisbon, Lesotho (inside South Africa), and the sea. */
  const at = await page.evaluate(async () => [await ccCountryAt(38.72, -9.14), await ccCountryAt(-29.6, 28.2), await ccCountryAt(-29.0, 25.0), await ccCountryAt(0, -30)]);
  ok(at[0] === 'PT' && at[1] === 'LS' && at[2] === 'ZA' && !at[3], 'Lisbon is Portugal, Lesotho is not South Africa, the open sea is nowhere', at);
}

section('Refused location is said, and the list still works');
{
  /* The browser answering "denied", as it does when somebody blocks the site. */
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1, message: 'denied' }), 50); });
  await page.click('[data-dact="tkCountry"]');
  await page.waitForSelector('#ccp-loc');
  await page.click('#ccp-loc');
  await page.waitForFunction(() => { const t = (document.getElementById('ccp-msg') || {}).textContent || ''; return t.length > 10 && !/Finding/.test(t); }, null, { timeout: 30000 });
  const m = await page.evaluate(() => ({ msg: document.getElementById('ccp-msg').textContent, rows: document.querySelectorAll('#ccp-list [data-ccp]').length }));
  ok(/location|list/i.test(m.msg) && m.rows > 50, 'it says why, and every country is still there to pick', m);
  await page.evaluate(() => closeOvr());
}

section('Another language draws the tasks again (Build 16 audit D16-12)');
{
  /* The list holds titles already turned into a language; it is kept per
     country AND language, so a switch builds it again rather than showing
     the old language's titles. */
  const r = await page.evaluate(async () => {
    let built = 0; const real = window.ccTasks; window.ccTasks = (d) => { built++; return real(d); };
    const was = loadStr('amv_lang');
    setTab('chat'); setTab('tasks');
    await new Promise(x => setTimeout(x, 600));
    const same = built;
    saveStr('amv_lang', was === 'es' ? 'fr' : 'es');
    setTab('chat'); setTab('tasks');
    await new Promise(x => setTimeout(x, 1200));
    const after = built;
    saveStr('amv_lang', was || ''); window.ccTasks = real;
    return { same, after };
  });
  ok(r.same === 0 && r.after >= 1, 'the same language reuses the list; a new one builds it again', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
