/* EVERY INTEGRATION IS ORDERED BY WHAT PEOPLE USE (Nov 16, the owner: "all
   backed up by research - every section, every country, every integration").

   Inside each topic on Integrations, after what is connected and what can
   connect, the apps go in the order people in the visitor's country load
   them (Chrome UX Report, data/app-reach.json, scripts/app-reach.mjs). Held:

     · the data is in step with the catalogue - every app on the screen is in
       it, and nothing in it is an app the screen no longer has;
     · every app's website is recorded (or recorded as having none), so the
       measure is of the app's own site and nothing is left to a guess;
     · it measures what it says: facts anybody can check - Naver is Korea's
       mail, Mercado Libre and iFood are Brazil's, Swiggy is India's;
     · the screen follows it, per country: in Korea Naver Mail comes before
       Yahoo Mail, in the United States after it;
     · without the data, the screen still draws, in the written order. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cat = readFileSync(join(ROOT, 'src/app/13c-app-catalog.js'), 'utf8');
const CATS = (0, eval)(cat.match(/const AMV_APP_CATS = (\[[\s\S]*?\n\]);/)[1].replace(/\/\*[\s\S]*?\*\//g, ''));
const view = readFileSync(join(ROOT, 'src/integrations/integrations-view.js'), 'utf8');
const WEB = (0, eval)('(' + view.match(/const AMV_APP_WEB = (\{[\s\S]*?\n\});/)[1] + ')');
const { APP_SITES } = await import(join(ROOT, 'scripts/app-sites.mjs'));
const D = JSON.parse(readFileSync(join(ROOT, 'data/app-reach.json'), 'utf8'));
const names = [...new Set(CATS.flatMap(c => c.apps.map(a => String(a).split('|')[0])))];

section('The data is in step with the screen, and every app’s site is recorded');
{
  const missing = names.filter(n => !D.apps.includes(n)), extra = D.apps.filter(n => !names.includes(n));
  ok(missing.length === 0 && extra.length === 0, 'every app on Integrations is measured, and nothing else - else run node scripts/app-reach.mjs', { missing, extra });
  const unrecorded = names.filter(n => !Object.prototype.hasOwnProperty.call(APP_SITES, n) && !WEB[n]);
  ok(unrecorded.length === 0, 'every app has its website recorded, or null for none', unrecorded);
  const cs = Object.keys(D.c);
  ok(cs.length >= 100, cs.length + ' countries', cs.length);
  const bad = [D.g, ...Object.values(D.c)].filter(s => typeof s !== 'string' || s.length !== D.apps.length || /[^0-7]/.test(s));
  ok(bad.length === 0 && /^\d{6}$/.test(D.month), 'one bucket per app per country, from the ' + D.month + ' report', bad.length);
  const measured = [...D.g].filter(x => x !== '0').length;
  ok(measured >= names.length * 0.85, measured + ' of ' + names.length + ' apps measured worldwide', measured);
}

section('It measures what it says - facts anybody can check');
{
  const b = (app, cc) => +((cc ? D.c[cc] : D.g)[D.apps.indexOf(app)] || 0);
  ok(b('Naver Mail (네이버 메일)', 'KR') === 1, 'Naver Mail is in Korea’s top thousand', b('Naver Mail (네이버 메일)', 'KR'));
  ok(b('Mercado Libre', 'BR') === 1 && b('iFood', 'BR') === 1, 'Mercado Libre and iFood in Brazil’s', [b('Mercado Libre', 'BR'), b('iFood', 'BR')]);
  ok(b('Swiggy', 'IN') && b('Swiggy', 'IN') <= 2, 'Swiggy near the top in India', b('Swiggy', 'IN'));
  ok(!b('Swiggy', 'US') || b('Swiggy', 'US') > b('Swiggy', 'IN'), 'and further down in the United States', b('Swiggy', 'US'));
  ok(b('Amazon', 'DE') === 1 && b('Indeed', 'GB') === 1, 'a brand with a site per country counts there (amazon.de, uk.indeed.com)', [b('Amazon', 'DE'), b('Indeed', 'GB')]);
}

const order = async (page, cc, topic) => page.evaluate(async ([cc, topic]) => {
  _cwSetCountry(cc); setTab('integrations');
  for (let i = 0; i < 80 && !document.querySelector('.ss2[data-topic="' + topic + '"] .int-name'); i++) await new Promise(r => setTimeout(r, 50));
  const b = document.querySelector('.ss2[data-topic="' + topic + '"] [data-app-more]');
  if (b && b.getAttribute('aria-expanded') === 'false') { b.click(); await new Promise(r => setTimeout(r, 300)); }
  return [...document.querySelectorAll('.ss2[data-topic="' + topic + '"] .int-name')].map(e => e.textContent.trim());
}, [cc, topic]);

section('The screen follows it, country by country');
{
  const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
  const { page, errors } = app;
  const kr = await order(page, 'KR', 'email');
  ok(kr.indexOf('Naver Mail (네이버 메일)') >= 0 && kr.indexOf('Naver Mail (네이버 메일)') < kr.indexOf('Yahoo Mail'), 'in Korea, Naver Mail before Yahoo Mail', kr.slice(0, 6));
  const us = await order(page, 'US', 'email');
  ok(us.indexOf('Yahoo Mail') >= 0 && us.indexOf('Yahoo Mail') < us.indexOf('Naver Mail (네이버 메일)'), 'in the United States, Yahoo Mail before Naver Mail', us.slice(0, 6));
  ok(us[0] === 'Gmail', 'and Gmail first in both', [kr[0], us[0]]);
  /* Where the written order and the measured one disagree: the catalogue
     lists Walmart before Mercado Libre; people in Brazil use Mercado Libre. */
  const br = await order(page, 'BR', 'shop'), us2 = await order(page, 'US', 'shop');
  ok(br.indexOf('Mercado Libre') >= 0 && br.indexOf('Mercado Libre') < br.indexOf('Walmart'), 'in Brazil, Mercado Libre before Walmart', br.slice(0, 8));
  ok(us2.indexOf('Walmart') >= 0 && us2.indexOf('Walmart') < us2.indexOf('Mercado Libre'), 'in the United States, Walmart before Mercado Libre', us2.slice(0, 8));
  const loaded = await page.evaluate(() => typeof window._appReachKey === 'function' && window._appReachKey({ name: 'Gmail', how: 'g' }, 'US') === 1);
  ok(loaded, 'the order came from the data (Gmail: top thousand in the United States)', loaded);
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await app.close();
}

section('Without the data, the screen still draws, in the written order');
{
  const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' },
    blockServiceWorkers: true, beforeLoad: async (page) => { await page.route('**/app-reach.json', r => r.fulfill({ status: 404, body: '' })); } });
  const { page, errors } = app;
  const us = await order(page, 'US', 'email');
  ok(us[0] === 'Gmail' && us.length > 5, 'Email is there, Gmail first', us.slice(0, 4));
  const none = await page.evaluate(() => window._appReachKey({ name: 'Gmail', how: 'g' }, 'US'));
  ok(none === null, 'and nothing claims an order it does not have', none);
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await app.close();
}

report();
done();
