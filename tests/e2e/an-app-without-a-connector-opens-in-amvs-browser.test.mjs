/* AN APP WITHOUT A CONNECTOR OPENS IN AMV'S BROWSER (Nov 15, the owner: "add
   more connections ... how is Crew going to do it if it is not connected?").

   AMV's own browser is how chat and Crew reach any service with a sign-in, so
   an app with a real website offers Use - the site opened there, the person
   signing in themselves - instead of only Notify me. What is held:
     · every address is the app's own, written out (no scheme, no query, no
       search), and every app it names is in the catalogue;
     · money, health, cloud and smart-home apps are never offered this way,
       and neither is a country's bank - a signed-in session there could move
       money or things;
     · pressing Use writes the sentence that names the address, in chat;
     · an app with no website still says Notify me. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 }, user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

section('Each address is the app’s own, and each app is in the catalogue');
{
  /* The map lives in the Integrations screen's own file, fetched when it opens. */
  await page.evaluate(() => { document.getElementById('ck')?.remove(); setTab('integrations'); });
  await page.waitForFunction(() => typeof window.AMV_APP_WEB === 'object', null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const byName = {};
    AMV_APP_CATS.forEach(c => c.apps.forEach(a => { const [n, how] = a.split('|'); byName[n] = { cat: c.id, how }; }));
    const entries = Object.entries(AMV_APP_WEB);
    return {
      n: entries.length,
      unknown: entries.filter(([n]) => !byName[n]).map(([n]) => n),
      connected: entries.filter(([n]) => byName[n] && byName[n].how).map(([n]) => n),
      shape: entries.filter(([, h]) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[A-Za-z0-9/_-]*)?$/.test(h)).map(([n, h]) => n + ' ' + h),
      risky: entries.filter(([n]) => ['money', 'health', 'cloud', 'security', 'monitor'].includes((byName[n] || {}).cat) || /Snowflake|BigQuery|Databricks|MongoDB|PostgreSQL|MySQL|Segment/.test(n)).map(([n]) => n),
    };
  });
  ok(r.n >= 150, 'a real share of the catalogue - ' + r.n + ' apps', r.n);
  ok(r.unknown.length === 0, 'every one is an app the catalogue lists', r.unknown);
  ok(r.connected.length === 0, 'and none of them already has a connector of its own', r.connected);
  ok(r.shape.length === 0, 'each a bare address - no scheme, no query, nothing searched for', r.shape.slice(0, 3));
  ok(r.risky.length === 0, 'and none is a money, health, cloud, database or security app - dashboards are, pipelines are not', r.risky);
}

section('On the page: Use for those, Notify me for the rest, Link for a bank');
{
  await page.evaluate(() => { document.getElementById('ck')?.remove(); _cwSetCountry('ES'); setTab('integrations'); });
  await page.waitForFunction(() => document.querySelector('#int-catalog .cc-svc'), null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(async () => {
    /* Every topic opened whole. */
    for (const b of [...document.querySelectorAll('#int-catalog [data-app-more][aria-expanded="false"]')]) { b.click(); await new Promise(r => setTimeout(r, 20)); }
    const rows = [...document.querySelectorAll('#int-catalog .int-card')].map(c => ({
      n: (c.querySelector('.int-name') || {}).textContent, use: (c.querySelector('[data-int-use]') || {}).dataset?.intUse || '',
      notify: !!c.querySelector('[data-app-notify]'), svc: c.classList.contains('cc-svc'), kind: c.dataset.cc || '',
      act: ((c.querySelector('.int-act') || {}).textContent || '').trim() }));
    const web = rows.filter(x => x.use.indexOf('web:') === 0);
    return { web: web.length, want: Object.keys(AMV_APP_WEB).length,
             wrong: web.filter(x => x.use !== 'web:' + AMV_APP_WEB[x.n] + '|' + x.n).map(x => x.n).slice(0, 3),
             revolut: rows.find(x => x.n === 'Revolut'), signal: rows.find(x => x.n === 'Signal'),
             banks: rows.filter(x => x.svc && x.kind === 'bank').map(x => x.act) };
  });
  ok(r.web === r.want, 'every app with a website offers Use - ' + r.web, r);
  ok(r.wrong.length === 0, 'each pointing at its own address', r.wrong);
  ok(r.revolut && r.revolut.notify && !r.revolut.use, 'a money app is still Notify me', r.revolut);
  ok(r.signal && r.signal.notify && !r.signal.use, 'and so is an app with no website', r.signal);
  ok(r.banks.length > 0 && r.banks.every(a => a === 'Link'), 'and a country’s bank is Link, never opened in the browser', r.banks.slice(0, 3));
}

section('Use writes the sentence, naming the address, in chat');
{
  const v = await page.evaluate(async () => {
    const b = document.querySelector('#int-catalog [data-int-use="web:web.whatsapp.com|WhatsApp"]');
    if (!b) return { missing: true };
    b.click(); await new Promise(r => setTimeout(r, 450));
    return { tab: S.tab, val: (document.getElementById('mta') || {}).value || '' };
  });
  ok(!v.missing, 'WhatsApp has a Use button', v);
  ok(v.tab === 'chat' && /AMV’s browser/.test(v.val) && /web\.whatsapp\.com \(WhatsApp\)/.test(v.val) && /sign in myself/.test(v.val),
     'chat opens with AMV’s browser, the official address, and the person signing in', v.val);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
