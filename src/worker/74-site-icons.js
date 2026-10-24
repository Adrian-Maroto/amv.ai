/* ══════════════════════════════════════════════════════════════════════════
   A SOURCE'S ICON, FETCHED BY AMV AND NOT BY THE PERSON'S BROWSER.

   A research answer lists the sites it found and cited. Each one used to have
   a coloured swatch where its icon would be. Pointing an <img> at every site's
   /favicon.ico is four lines in the page and wrong: each person's browser
   would announce itself - address, browser, the moment they asked - to every
   site in every answer, which is exactly what reading through AMV is meant to
   spare them. So AMV fetches the icon, keeps it, and serves it from its own
   origin, the way the connector logos are served (38-connector-logos.js).

   The difference from the logos is the one that matters: there, the URL is
   derived from a fixed pattern; here the HOST comes from search results, which
   are written by whoever ranks for the query. So:

     only a hostname is accepted - letters, digits, hyphens, dots, a letters-only
     last label - never a URL, a port, a path or an IP address, and never a
     name that only means something inside a network (localhost, .local,
     .internal, .arpa...);

     every request goes through fetchGuarded, the outbound gate that checks
     each redirect hop again;

     what comes back is believed by its BYTES, not its Content-Type (servers
     label favicon.ico as text/plain all the time): ICO, PNG, GIF, JPEG or
     WEBP. Never SVG - an SVG is a document that can carry script, and served
     from AMV's own origin it would run as AMV if somebody opened it directly;

     at most 64KB, four seconds a fetch, rate limited per IP before anything
     else, and answered with nosniff and a policy that forbids everything, so
     the bytes can only ever be an image;

     cached a fortnight, and a miss for a day, so a site is asked once rather
     than once per person who sees it.

   A miss is a 404; the page already shows the site's initial underneath. */
const SICON_TTL = 60 * 60 * 24 * 14;
const SICON_MISS_TTL = 60 * 60 * 24;
const SICON_MAX_BYTES = 64 * 1024;
const SICON_PAGE_BYTES = 96 * 1024;
const SICON_TIMEOUT = 4000;

/* A public hostname, or null. */
function _siteIconHost(v) {
  const h = String(v || '').trim().toLowerCase().replace(/\.$/, '');
  if (h.length < 4 || h.length > 253) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa|test|invalid|onion)$/.test(h)) return null;
  /* An address written inside a name: wildcard DNS services resolve
     10.0.0.7.nip.io to 10.0.0.7, so a name is refused when it carries four
     numbers in a row, or when every label but the last is a number. */
  if (/(^|\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.|$)/.test(h) || /^(\d+\.)+[a-z]+$/.test(h)) return null;
  return h;
}
/* An https URL on a public hostname with no port and no credentials, or null. */
function _siteIconUrl(u, base) {
  let x;
  try { x = new URL(String(u || ''), base); } catch (e) { return null; }
  if (x.protocol !== 'https:' || x.port || x.username || x.password) return null;
  if (!_siteIconHost(x.hostname)) return null;
  return x;
}
/* What the bytes are, whatever they were labelled. */
function _siteIconSniff(b) {
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
/* One GET through fetchGuarded - the outbound gate every address somebody
   else chose goes through, which re-checks each redirect hop - with the body
   read only up to `max` bytes. Null on anything else. */
async function _siteIconGet(url, accept, max) {
  let g;
  try { g = await fetchGuarded(url.href, { headers: { 'Accept': accept } }, SICON_TIMEOUT); }
  catch (e) { return null; }
  const r = g && !g.blocked && g.response;
  if (!r || !r.ok || !r.body) return null;
  const at = _siteIconUrl(r.url || url.href) || url;
  const reader = r.body.getReader();
  const parts = []; let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
      parts.push(value);
    }
  } catch (e) { return null; }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return { bytes: out, at };
}
/* The icons a page names for itself, best first: a plain `icon` before an
   apple-touch-icon, never a mask icon or an SVG. At most three are tried. */
function _siteIconLinked(html, base) {
  const links = String(html).match(/<link\b[^>]*>/gi) || [];
  const plain = [], touch = [];
  for (const l of links) {
    const rel = ((l.match(/\brel\s*=\s*["']([^"']+)["']/i) || l.match(/\brel\s*=\s*([^\s>]+)/i) || [])[1] || '').toLowerCase().split(/\s+/);
    const isPlain = rel.includes('icon'), isTouch = rel.some(r => /^apple-touch-icon/.test(r));
    if (!isPlain && !isTouch) continue;
    const href = (l.match(/\bhref\s*=\s*["']([^"']+)["']/i) || l.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
    if (!href || /\.svg(\?|#|$)/i.test(href)) continue;
    const u = _siteIconUrl(href.replace(/&amp;/g, '&'), base);
    if (u) (isPlain ? plain : touch).push(u);
  }
  return plain.concat(touch).slice(0, 3);
}

async function siteIcon(request, env) {
  const ip = _rlIp(request);
  const gate = await guardAction(env, `sicon:${ip}`, 300, 6000, 'site icons');
  if (gate) return gate;
  const host = _siteIconHost(new URL(request.url).searchParams.get('host'));
  if (!host) return new Response('no icon', { status: 404 });

  /* Named `..._CACHE_KEY`: a GET that writes is allowed only when what it
     writes is a cache (a-link-is-not-a-command), and the key's shape is
     checked here, where it is used. */
  const SICON_CACHE_KEY = 'sicon:' + host;
  if (!/^sicon:[a-z0-9.-]{4,253}$/.test(SICON_CACHE_KEY)) return new Response('no icon', { status: 404 });
  const send = (body, type) => new Response(body, { status: 200, headers: {
    'Content-Type': type, 'Cache-Control': 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  try {
    const hit = await env.AMV_KV.get(SICON_CACHE_KEY, 'arrayBuffer');
    if (hit) {
      if (!hit.byteLength) return new Response('no icon', { status: 404 });
      const t = _siteIconSniff(new Uint8Array(hit));
      if (t) return send(hit, t);
    }
  } catch (e) {}

  let body = null, type = null;
  const take = (got) => {
    const t = got && _siteIconSniff(got.bytes);
    if (t && got.bytes.byteLength) { body = got.bytes; type = t; return true; }
    return false;
  };
  const root = _siteIconUrl('https://' + host + '/');
  if (root) {
    if (!take(await _siteIconGet(new URL('/favicon.ico', root), 'image/*', SICON_MAX_BYTES))) {
      const page = await _siteIconGet(root, 'text/html', SICON_PAGE_BYTES);
      const linked = page ? _siteIconLinked(new TextDecoder().decode(page.bytes), page.at) : [];
      for (const u of linked) if (take(await _siteIconGet(u, 'image/*', SICON_MAX_BYTES))) break;
    }
  }
  try {
    await env.AMV_KV.put(SICON_CACHE_KEY, body || new ArrayBuffer(0), { expirationTtl: body ? SICON_TTL : SICON_MISS_TTL });
  } catch (e) {}
  if (!body) return new Response('no icon', { status: 404 });
  return send(body, type);
}
