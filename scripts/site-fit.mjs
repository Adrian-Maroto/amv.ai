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
   fewer labels (bbc.co.uk over news.bbc.co.uk; patagonia.com over
   eu.patagonia.com), then the shorter. A rule, not a lookup - so it says
   nothing about whether the service accepts people from the country, only
   which of its own sites is meant for them. */
const GENERIC = new Set(['com', 'org', 'net', 'int', 'edu', 'gov', 'info', 'biz', 'io', 'co', 'app', 'ai', 'tv', 'me', 'global', 'online', 'site', 'news']);
const own = (cc) => String(cc || '').toUpperCase() === 'GB' ? 'uk' : String(cc || '').toLowerCase();
export function siteFit(host, cc) {
  const h = String(host || '').toLowerCase(), tld = h.split('.').pop();
  if (tld === own(cc)) return 0;
  if (GENERIC.has(tld)) return 1;
  return tld.length === 2 ? 3 : 2;
}
/* Is `a` a better site than `b` for the country? Equal is not better, so an
   existing choice is only replaced by one that fits the country more. */
export function siteBetter(a, b, cc) {
  const fa = siteFit(a, cc), fb = siteFit(b, cc);
  if (fa !== fb) return fa < fb;
  const la = String(a).split('.').length, lb = String(b).split('.').length;
  if (la !== lb) return la < lb;
  return String(a).length < String(b).length;
}
