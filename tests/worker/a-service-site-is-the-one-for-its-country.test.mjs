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
import { siteFit, siteBetter } from '../../scripts/site-fit.mjs';

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

section('The data builder and the re-pick script use the rule');
{
  const data = readFileSync(join(ROOT, 'scripts', 'country-data.mjs'), 'utf8');
  ok(/import \{ siteBetter \} from '\.\/site-fit\.mjs'/.test(data) && /siteBetter\(e\.s, b\.s, cc\)/.test(data), 'country-data.mjs keeps the best-fitting site per organisation');
  const sites = readFileSync(join(ROOT, 'scripts', 'country-sites.mjs'), 'utf8');
  ok(/siteBetter\(h, best, cc\)/.test(sites) && /!used\.has\(h\)/.test(sites), 'country-sites.mjs replaces a site only with a better one no other entry uses');
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
