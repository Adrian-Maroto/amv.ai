/* THE CATALOGUE LISTS NO ADULT SITES (Nov 27, the owner, of the order of
   Tasks and Crew; found while measuring it). xHamster was filed as a company
   in 104 countries' data, CAM4 and CamSoda in sixty-odd, and a sex-toy shop
   as the United States' online shopping - so "Jobs at xHamster" sat in Work &
   career. One list, data/not-listed.json: the data scripts drop by it and the
   page refuses by its own copy, so a site the data lets through is still
   never shown. Held here: the two copies agree, no file holds one, and the
   page's check really refuses them. */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';
import { listed } from '../../scripts/not-listed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NL = JSON.parse(readFileSync(join(ROOT, 'data/not-listed.json'), 'utf8'));
const src = readFileSync(join(ROOT, 'src/country/country-catalog.js'), 'utf8');

section('The page holds the same list as the data');
const hosts = (0, eval)(src.match(/const CC_NOT_LISTED_HOSTS = new Set\((\[[^\]]*\])\);/)[1]);
const pat = src.match(/const CC_NOT_LISTED = \/(.+)\/i;/)[1];
ok(JSON.stringify([...hosts].sort()) === JSON.stringify([...NL.hosts].sort()), 'the same hosts', { page: hosts.length, data: NL.hosts.length });
ok(pat === NL.pattern, 'and the same pattern', { page: pat, data: NL.pattern });

section('The page’s own check refuses them');
{
  /* The page's own two functions, run as written, with its own list. */
  const fn = src.match(/function _ccListed\(s\)\{[^\n]*\}/)[0], goodFn = src.match(/function _ccGood\(e\)\{[\s\S]*?\n\}/)[0];
  const [pageListed, good] = (0, eval)('(() => { const CC_NOT_LISTED_HOSTS = new Set(' + JSON.stringify(hosts) + '); const CC_NOT_LISTED = /' + pat + '/i; '
    + fn + ' ' + goodFn + ' return [_ccListed, _ccGood]; })()');
  ok(!good({ q: 'Q1', n: 'xHamster', s: 'xhamster.com' }), 'an entry on a listed host is not a good entry');
  ok(!good({ q: 'Q1', n: 'Some tube', s: 'www.pornhub.com' }), 'nor one the pattern names, with www. in front');
  ok(good({ q: 'Q1', n: 'XXXLutz', s: 'xxxlutz.de' }) && good({ q: 'Q1', n: 'Sussex', s: 'sussex.ac.uk' }),
     'while a furniture shop and a university with the letters in their names are kept');
  ok(['camsoda.com', 'lovehoney.co.uk', 'fleshlight.com'].every(h => !pageListed(h) && !listed(h)), 'the page and the scripts refuse the same hosts');
}

section('No file holds one');
{
  const found = [];
  for (const f of readdirSync(join(ROOT, 'data/countries')).filter(f => /^[A-Z]{2}\.json$/.test(f))) {
    const d = JSON.parse(readFileSync(join(ROOT, 'data/countries', f), 'utf8'));
    for (const [k, list] of Object.entries(d.kinds || {})) for (const e of list) if (!listed(e.s)) found.push(f + ' ' + k + ' ' + e.s);
  }
  ok(found.length === 0, 'no country file', found.slice(0, 5));
  const g = JSON.parse(readFileSync(join(ROOT, 'public/global-services.json'), 'utf8'));
  const gb = g.entries.filter(x => !listed(x[2])).map(x => x[2]);
  ok(gb.length === 0, 'and not the worldwide services', gb.slice(0, 5));
}

report();
done();
