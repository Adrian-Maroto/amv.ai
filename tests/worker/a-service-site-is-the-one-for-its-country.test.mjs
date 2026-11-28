/* A SERVICE'S SITE IS THE ONE FOR ITS COUNTRY (Nov 28, Build 19 audit NEW-06,
   NEW-12, B19-R-09).

   Two defects, one cause each:
   - the data builder kept whichever of an organisation's official websites
     Wikidata returned first, so the United States listed Business Insider as
     businessinsider.com.pl and Amazon Prime Video as amazon.co.jp;
   - the page remembered a service by its Wikidata id alone, so after
     switching from the United States to the United Kingdom, Use on The
     Independent opened the American site the first country had registered.

   This holds the choosing rule (scripts/site-fit.mjs, used by country-data.mjs
   and country-sites.mjs) and the page's registry (country-catalog.js). */
import vm from 'vm';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { siteFit, siteBetter, siteRelated } from '../../scripts/site-fit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('Of an organisation\'s sites, the one for the country');
{
  const pick = (cc, ...hosts) => hosts.reduce((b, h) => siteBetter(h, b, cc) ? h : b);
  ok(pick('US', 'businessinsider.com.pl', 'businessinsider.com') === 'businessinsider.com', 'the United States gets businessinsider.com, not the Polish edition');
  ok(pick('US', 'amazon.co.jp', 'primevideo.com') === 'primevideo.com', 'and Prime Video, not Amazon Japan');
  ok(pick('GB', 'the-independent.com', 'independent.co.uk') === 'independent.co.uk', 'the United Kingdom gets the .co.uk');
  ok(pick('ES', 'bbva.com', 'bbva.es') === 'bbva.es', 'Spain gets bbva.es');
  ok(pick('US', 'eu.patagonia.com', 'patagonia.com') === 'patagonia.com', 'between two generic sites, the plain one');
  ok(!siteBetter('bbva.com', 'bbva.com', 'ES'), 'and equal is never "better", so a fitting choice is not churned');
  ok(siteFit('lemonde.fr', 'AE') === 3, 'another country\'s domain fits last - kept only when it is the organisation\'s only site');
}

section('Length is not a reason, and a replacement must be the same organisation');
{
  /* The first run of the rule broke ties by the shorter host. Each of these
     was a real move it made, and each was wrong. */
  ok(!siteBetter('philly.com', 'inquirer.com', 'US'), 'philly.com is not better than inquirer.com for being shorter');
  ok(!siteBetter('detnews.com', 'detroitnews.com', 'US') && !siteBetter('rdg.ac.uk', 'reading.ac.uk', 'GB'),
     'nor a retired domain (detnews.com, rdg.ac.uk) over the current one');
  ok(!siteBetter('nationaudio.com', 'nation.africa', 'KE'), 'a region\'s domain (.africa) is not foreign: the Daily Nation keeps nation.africa');
  const r = { 'hollywoodreporter.com': 1000, 'thr.com': 0 };
  ok(!siteBetter('thr.com', 'hollywoodreporter.com', 'KE', h => r[h]) && siteBetter('hollywoodreporter.com', 'thr.com', 'KE', h => r[h]),
     'between two that fit alike, the one more visited from the country wins');
  ok(!siteRelated('manoramanews.com', 'Malayala Manorama', 'manoramaonline.com'), 'the television channel\'s site is not the newspaper\'s');
  ok(!siteRelated('erabaru.net', 'The Epoch Times', 'theepochtimes.com'), 'erabaru.net (the Indonesian edition) is not The Epoch Times\' site');
  ok(!siteRelated('urb-bd.org', 'University of Chicago', 'uchicago.hk'), 'nor urb-bd.org the University of Chicago\'s');
  ok(siteRelated('primevideo.com', 'Amazon Prime Video', 'amazon.co.jp') && siteRelated('barclays.co.uk', 'Barclays', 'home.barclays')
     && siteRelated('usc.edu', 'University of Southern California', 'usc.cn'),
     'while primevideo.com, barclays.co.uk and usc.edu are recognisably theirs');
  const sites = readFileSync(join(ROOT, 'scripts', 'country-sites.mjs'), 'utf8');
  ok(/siteRelated\(h, e\.n, e\.s\) && siteBetter\(h, best, cc, rank\)/.test(sites), 'and the re-pick script requires both, with the country\'s visits');
}

section('The data builder and the re-pick script use the rule');
{
  const data = readFileSync(join(ROOT, 'scripts', 'country-data.mjs'), 'utf8');
  ok(/import \{ siteBetter \} from '\.\/site-fit\.mjs'/.test(data) && /siteBetter\(e\.s, b\.s, cc\)/.test(data), 'country-data.mjs keeps the best-fitting site per organisation');
  const sites = readFileSync(join(ROOT, 'scripts', 'country-sites.mjs'), 'utf8');
  ok(/siteBetter\(h, best, cc, rank\)/.test(sites) && /!used\.has\(h\)/.test(sites), 'country-sites.mjs replaces a site only with a better one no other entry uses');
  ok(/crux\(cc, ym\)/.test(sites), 'and ranks a changed site by the same Chrome month as its file');
}

section('The page remembers a service by its id AND its site');
{
  const src = readFileSync(join(ROOT, 'public', 'country-catalog.js'), 'utf8');
  const ctx = { window: {}, console, T: (s) => s, escH: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(src + ';window.__svc = { _ccRegisterService, _ccSvcKey, _ccSvc };', ctx);
  const { _ccRegisterService, _ccSvcKey, _ccSvc } = ctx.window.__svc;
  const us = { kind: 'newspaper', e: { q: 'Q11149', n: 'The Independent', s: 'the-independent.com' } };
  const gb = { kind: 'newspaper', e: { q: 'Q11149', n: 'The Independent', s: 'independent.co.uk' } };
  const a = _ccRegisterService(us), b = _ccRegisterService(gb);
  ok(a !== b && _ccSvc[a].e.s === 'the-independent.com' && _ccSvc[b].e.s === 'independent.co.uk',
     'the same organisation in two countries is two rows, each with its own site', { a, b });
  ok(_ccSvcKey(gb) === b, 'and a row\'s button names its own key');
}

report();
done();
