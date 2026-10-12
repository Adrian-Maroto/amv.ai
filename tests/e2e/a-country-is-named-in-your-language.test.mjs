/* A COUNTRY IS NAMED IN YOUR LANGUAGE, AND THE SENTENCE AROUND IT IS YOURS.

   Crew read "Not in United States?" to somebody reading AMV in Spanish:
   T('Not in') + ' ' + an English country name + '?'. Three pieces, two of them
   English, glued in English order - no language pack could ever have matched
   it. The same was true of "Popular in", "Answers for", "Uses: Calendar,
   Email" and the sentence saying when a job runs, which also told two missing
   accounts that they "is connected".

   Each is one whole sentence with a slot now, and the country's name comes
   from the browser's own list of region names (Intl.DisplayNames). English
   reads exactly as it did, which the Crew suites hold. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

const lang = (c) => page.evaluate(async (c) => {
  saveStr('amv_lang', c);
  try { _translateUI(); } catch (e) {}
  for (let i = 0; i < 50 && c !== 'en' && !_i18nPackHave(c); i++) await new Promise(s => setTimeout(s, 100));
}, c);

const read = () => page.evaluate(() => {
  const two = { id: 't', needs: 'Calendar, Email', title: 'T' };
  const mail = { id: 'm', needs: 'Email, Web research', title: 'M', mailName: 'Gmail' };
  /* Nothing connected in a fresh page, so a job needing two accounts names both. */
  const st = _cwWhereState(two);
  return {
    notIn: _cwSayPlace('Not in {country}?', 'United States', _cwThe('United States')),
    popular: _cwSayPlace('Popular in {country}', 'Japan'),
    name: _cwPlaceName('Germany'),
    where: st === 'pending' ? _cwWhereLabel(two) : '(state ' + st + ')',
    uses: _cwUsesLine(mail),
  };
});

section('In English, the words are the ones Crew always used');
{
  await lang('en');
  const r = await read();
  ok(r.notIn === 'Not in the United States?', 'Not in the United States?', r.notIn);
  ok(r.popular === 'Popular in Japan', 'Popular in Japan', r.popular);
  ok(r.name === 'Germany', 'a country keeps its English name', r.name);
  ok(/once a calendar and a mailbox are connected$/.test(r.where), 'two missing accounts "are" connected, not "is"', r.where);
  ok(r.uses === 'Uses: Gmail, Web research', 'a mail job names the app it reads', r.uses);
}

section('In Spanish, the sentence and the country are Spanish');
{
  await lang('es');
  const r = await read();
  ok(r.notIn === '¿No estás en Estados Unidos?', 'the country button', r.notIn);
  ok(r.popular === 'Popular en Japón', 'the integrations card', r.popular);
  ok(r.name === 'Alemania', 'the name comes from the browser’s own list', r.name);
  ok(/un calendario y un buzón de correo/.test(r.where) && !/[a-z] is connected/.test(r.where), 'what a job waits for', r.where);
  ok(r.uses === 'Usa: Gmail, Búsqueda web', 'and what it uses - the app name stays a name', r.uses);
  const pick = await page.evaluate(async () => {
    S.tab = 'crew'; setTab('crew'); await new Promise(s => setTimeout(s, 300));
    cwMoreCountries(); await new Promise(s => setTimeout(s, 400));
    const names = [...document.querySelectorAll('.cw-cpick-n')].map(e => e.textContent);
    const f = document.getElementById('cw-cfind');
    f.value = 'united'; f.dispatchEvent(new Event('input'));
    const found = [...document.querySelectorAll('.cw-cpick:not([hidden]) .cw-cpick-n')].map(e => e.textContent);
    try { cwBackMain(); } catch (e) {}
    return { names, found };
  });
  ok(pick.names.includes('Estados Unidos') && !pick.names.includes('United States'), 'the country list is in Spanish', pick.names.slice(0, 5));
  const i = pick.names.indexOf('Alemania'), j = pick.names.indexOf('Estados Unidos');
  ok(i >= 0 && j > i, 'and sorted the Spanish way', [i, j]);
  ok(pick.found.includes('Estados Unidos'), 'typing the English name still finds it', pick.found);
}

section('In Japanese, the country goes where Japanese puts it');
{
  await lang('ja');
  const r = await read();
  ok(r.notIn === 'アメリカ合衆国にいませんか?', 'the country first, the question after', r.notIn);
  await lang('en');
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-country-is-named-in-your-language') > 0) process.exitCode = 1;
done();
