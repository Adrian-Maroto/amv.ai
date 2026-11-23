/* POPULAR IS FIFTY EVERYDAY JOBS, IN EVERY COUNTRY (Nov 22).

   The owner: "for popular ones for all the countries (50 popular) make sure
   they are truly the most popular between teens and adults ... don't make
   them a one time thing like your rights as a tenant, make them things that
   people can do every day. This applies to all countries."

   Driven in a real browser: for several countries, Popular holds exactly
   fifty jobs, every one of them repeats (hourly, daily or weekly), none is a
   one-off guide, the researched list leads it in order, a service that is
   blocked nationwide is not offered there, a job opens from its id, and its
   words arrive in the person's language. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'node:fs';

const data = readFileSync(new URL('../../src/crew/crew-data.js', import.meta.url), 'utf8');
ok(/popular:\s*\[/.test(data), 'the catalogue holds a researched popular list');

const app = await bootApp({ tab: 'crew' });
const p = app.page;
await p.waitForFunction(() => typeof _cwPopularList === 'function' && _cwPopularList().length > 0, null, { timeout: 30000 }).catch(() => {});
const listed = await p.evaluate(() => _cwPopularList().map(m => m[1]));
section('The researched list');
ok(listed.length === 50, 'fifty researched rows (got ' + listed.length + ')');
ok(new Set(listed).size === listed.length, 'no row twice');

const ONE_OFF = /\b(rights?|how to|guide|explain|what is|apply for a (visa|passport)|register|tenant|lease|one[- ]time)\b/i;
for (const cc of ['US', 'IN', 'CN', 'BR', 'NG', 'DE']) {
  section('Popular in ' + cc);
  const r = await p.evaluate(async (cc) => {
    _cwSetCountry(cc);
    const t0 = Date.now();
    while (!((window._ccCrewJobs || {})[cc]) && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 200));
    const list = _cjPopular();
    const one = list[0] ? _cwFindJob(list[0].id) : null;
    return { n: list.length, ids: list.map(j => j.id), every: list.map(j => j.every), titles: list.map(j => j.title), found: !!(one && one.title === list[0].title), prompts: list.filter(j => j.popular).map(j => j.prompt || '') };
  }, cc);
  ok(r.n === 50, 'fifty jobs (got ' + r.n + ')');
  ok(r.every.every(e => ['hourly', 'daily', 'weekly'].indexOf(String(e || 'daily')) >= 0), 'every job repeats');
  const bad = r.titles.filter(t => ONE_OFF.test(t));
  ok(bad.length === 0, 'no one-off guide' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  const pre = 'cc_' + cc.toLowerCase() + '_p_';
  ok(r.ids[0] === pre + 'mail_morning', 'the researched list leads (' + r.ids[0] + ')');
  ok(r.found, 'a Popular job opens from its id');
  ok(r.prompts.length > 0 && r.prompts.every(s => s.length > 40), 'every researched job carries an instruction');
  if (cc === 'CN') ok(!r.ids.some(id => /_(yt_posts|ig_posts|tiktok_posts|x_posts|reddit_hot|linkedin_company)$/.test(id)), 'nothing blocked in China is offered there');
  if (cc === 'IN') ok(!r.ids.some(id => /_tiktok_posts$/.test(id)), 'TikTok is not offered in India');
  if (cc === 'US') ok(r.ids.some(id => /_tiktok_posts$/.test(id)) && r.ids.some(id => /_linkedin_company$/.test(id)), 'where nothing is blocked, the social jobs are there');
}

section('In the person’s language');
/* Read from the language packs the page fetches (public/i18n), for every
   title, line and question the researched list shows. */
const keys = await p.evaluate(() => { const k = []; for (const m of _cwPopularList()) { k.push(m[5], m[6]); if (m[7]) k.push(m[7]); } return [...new Set(k)]; });
for (const lang of ['es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru', 'id', 'bn', 'ur', 'tr', 'vi', 'it', 'ko', 'ta']) {
  const pack = JSON.parse(readFileSync(new URL('../../public/i18n/' + lang + '.json', import.meta.url), 'utf8'));
  const missing = keys.filter(k => !pack[k] || pack[k] === k);
  ok(missing.length === 0, lang + ': all ' + keys.length + ' Popular strings translated' + (missing.length ? ' (missing ' + missing.slice(0, 3).join(' | ') + ')' : ''));
}
const es = JSON.parse(readFileSync(new URL('../../public/i18n/es.json', import.meta.url), 'utf8'));
ok(es['Find me internships'] === 'Búscame prácticas', 'es reads "' + es['Find me internships'] + '"');

await app.close();
report(); done();
