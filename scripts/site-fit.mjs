/* WHICH OF AN ORGANISATION'S WEBSITES IS THE ONE FOR THIS COUNTRY (Nov 28).

   Wikidata lists several official websites (P856) for many organisations -
   one per market. The country query returns one row per site, and the first
   row seen was kept, so the choice was arbitrary: the United States' file
   gave Business Insider as businessinsider.com.pl and Amazon Prime Video as
   amazon.co.jp (Build 19 audit, NEW-06/NEW-12). A site is where somebody
   signs in and what a ranking is measured on, so the wrong market's site is
   wrong twice.

   The rule, for a country: its own country-code domain first (.es for Spain,
   .co.uk for the United Kingdom); then a generic domain (.com, .org...);
   another country's domain last. Between two that fit equally, the one with
   fewer labels (patagonia.com over eu.patagonia.com); then the one more
   visited from the country, when the Chrome UX Report says so; otherwise
   neither is better and the current one stays.

   The first version broke the last tie by the SHORTER host, and its first run
   moved The Epoch Times to erabaru.net (its Indonesian edition), the
   Philadelphia Inquirer to philly.com and three British universities to
   their retired domains: Wikidata keeps old and sister sites as "official"
   too, and length says nothing about which one people use. So length is not
   a reason, and a replacement must also be recognisably the same
   organisation (`siteRelated`). A rule, not a lookup - it says nothing about
   whether the service accepts people from the country, only which of its own
   sites is meant for them. */
const GENERIC = new Set(['com', 'org', 'net', 'int', 'edu', 'gov', 'info', 'biz', 'io', 'co', 'app', 'ai', 'tv', 'me', 'global', 'online', 'site', 'news']);
const SECOND = new Set(['co', 'com', 'ac', 'org', 'net', 'gov', 'edu', 'ne', 'or', 'go', 'gob', 'gouv', 'nic', 'mil']);
const own = (cc) => String(cc || '').toUpperCase() === 'GB' ? 'uk' : String(cc || '').toLowerCase();
/* Every domain that is not a country's - .com, and also a region's or a
   brand's (.africa, .brussels, .barclays) - fits alike: nation.africa is the
   Daily Nation's site, and ranking it below nationaudio.com moved Kenya's
   largest paper to its radio station. Only another COUNTRY's domain is
   foreign. Two-letter domains used generically (.co, .io, .tv ...) count as
   generic. */
export function siteFit(host, cc) {
  const h = String(host || '').toLowerCase(), tld = h.split('.').pop();
  if (tld === own(cc)) return 0;
  if (GENERIC.has(tld) || tld.length !== 2) return 1;
  return 3;
}
/* Is `a` a better site than `b` for the country? `rank(host)` is the Chrome
   UX Report bucket for visits from the country (1000 = top thousand), 0 or
   undefined when unmeasured. Equal is not better, so an existing choice is
   only replaced by one that fits the country more. */
export function siteBetter(a, b, cc, rank) {
  const fa = siteFit(a, cc), fb = siteFit(b, cc);
  if (fa !== fb) return fa < fb;
  const la = String(a).split('.').length, lb = String(b).split('.').length;
  if (la !== lb) return la < lb;
  const ra = (rank && +rank(a)) || 0, rb = (rank && +rank(b)) || 0;
  return ra > 0 && (rb === 0 || ra < rb);
}
/* The part of a host that names the organisation: "inquirer" in
   inquirer.com, "barclays" in barclays.co.uk. */
export function siteLabel(host) {
  const p = String(host || '').toLowerCase().split('.');
  p.pop();
  if (p.length > 1 && SECOND.has(p[p.length - 1])) p.pop();
  return p.pop() || '';
}
const squash = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
/* Is `host` recognisably the organisation named `name`, whose site was
   `was`? Its label is in the name (primevideo in "Amazon Prime Video",
   suntimes in "Chicago Sun-Times"), or it and the old site's label contain
   one another (usc, wga/wgaeast). erabaru.net for The Epoch Times, and
   urb-bd.org for the University of Chicago, are neither. */
export function siteRelated(host, name, was) {
  const l = siteLabel(host), n = squash(name), w = siteLabel(was);
  if (l.length < 2) return false;
  return n.indexOf(l) >= 0 || (!!w && (w.indexOf(l) >= 0 || l.indexOf(w) >= 0));
}
/* The kinds that are no use to somebody unless they operate in their country:
   an account, a line, a weekly shop, a ticket, a place to go. Not
   restaurants, hotels or shop chains (franchised and opened everywhere -
   Wikidata places IKEA in Sweden, not the United States), not airlines (they
   fly in), not online shops (they ship), not universities (people apply
   abroad: MIT is useful from Pakistan). The page's copy of this list is
   CC_LOCAL_KINDS in country-catalog.js, and a suite holds them equal. */
export const LOCAL_KINDS = new Set(['bank', 'insurer', 'telecom', 'isp', 'utility', 'supermarket', 'mall',
  'rail', 'bus', 'hospital', 'school', 'agency', 'ministry']);
