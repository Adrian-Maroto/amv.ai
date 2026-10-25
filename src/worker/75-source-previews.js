/* ══════════════════════════════════════════════════════════════════════════
   A CITED SOURCE'S PICTURE, FETCHED BY AMV AND NOT BY THE PERSON'S BROWSER.

   A research answer about a hotel, a place or a product reads better with the
   picture the page itself chose to represent it - the og:image every site
   sets for its link previews. The same rule as a site's icon applies
   (74-site-icons.js), and for the same reason: an <img> pointed at the site
   would announce the person to it. So AMV fetches the page, reads the picture
   it names, fetches that, and serves it from its own origin.

   It takes a whole address rather than a host, which is the difference that
   needs care, so:

     only https on a public hostname, no port, no credentials - checked by the
     icon route's own _siteIconUrl, and every hop of every redirect again by
     fetchGuarded;

     only the first SPREV_PAGE_BYTES of the page are read - the tags are in its
     head - and only a picture the page names in og:image or twitter:image, on
     a public https address of its own;

     only JPEG, PNG, GIF or WEBP, decided by the bytes; never SVG; at most
     SPREV_MAX_BYTES, four seconds a fetch, rate limited per IP before
     anything else, served with nosniff and a policy that forbids everything;

     kept a week by the page's address, and a miss a day, so a page is asked
     once rather than once per person who sees the answer.

   Shown by the page for CITED sources only - the ones the answer stands on.
   A miss is a 404, and the page shows the source without a picture. */
const SPREV_TTL = 60 * 60 * 24 * 7;
const SPREV_MISS_TTL = 60 * 60 * 24;
const SPREV_MAX_BYTES = 300 * 1024;
const SPREV_PAGE_BYTES = 128 * 1024;

/* The picture a page names for its link previews, or null. */
function _sourcePreviewNamed(html, base) {
  const metas = String(html).match(/<meta\b[^>]*>/gi) || [];
  const want = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  const found = {};
  for (const m of metas) {
    const key = ((m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    if (!want.includes(key) || found[key]) continue;
    const v = (m.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (v) found[key] = v.replace(/&amp;/g, '&').trim();
  }
  for (const k of want) {
    if (!found[k] || /\.svg(\?|#|$)/i.test(found[k])) continue;
    const u = _siteIconUrl(found[k], base);
    if (u) return u;
  }
  return null;
}
/* What the bytes are, if they are a photograph-shaped image: an icon is not a
   preview, so ICO is not accepted here. */
function _sourcePreviewSniff(b) {
  const t = _siteIconSniff(b);
  return t && t !== 'image/x-icon' ? t : null;
}

async function sourcePreview(request, env) {
  const ip = _rlIp(request);
  const gate = await guardAction(env, `sprev:${ip}`, 120, 3000, 'source previews');
  if (gate) return gate;
  const page = _siteIconUrl(new URL(request.url).searchParams.get('url'));
  if (!page || page.href.length > 2000) return new Response('no preview', { status: 404 });
  page.hash = '';

  /* Named `..._CACHE_KEY`: a GET that writes is allowed only when what it
     writes is a cache (a-link-is-not-a-command); the key is a digest of the
     address, so its shape is fixed whatever the address was. */
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(page.href)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const SPREV_CACHE_KEY = 'sprev:' + digest;
  if (!/^sprev:[0-9a-f]{64}$/.test(SPREV_CACHE_KEY)) return new Response('no preview', { status: 404 });
  const send = (body, type) => new Response(body, { status: 200, headers: {
    'Content-Type': type, 'Cache-Control': 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  try {
    const hit = await env.AMV_KV.get(SPREV_CACHE_KEY, 'arrayBuffer');
    if (hit) {
      if (!hit.byteLength) return new Response('no preview', { status: 404 });
      const t = _sourcePreviewSniff(new Uint8Array(hit));
      if (t) return send(hit, t);
    }
  } catch (e) {}

  let body = null, type = null;
  const got = await _siteIconGet(page, 'text/html', SPREV_PAGE_BYTES, true);
  const pic = got ? _sourcePreviewNamed(new TextDecoder().decode(got.bytes), got.at) : null;
  if (pic) {
    const img = await _siteIconGet(pic, 'image/*', SPREV_MAX_BYTES);
    const t = img && _sourcePreviewSniff(img.bytes);
    if (t && img.bytes.byteLength) { body = img.bytes; type = t; }
  }
  try {
    await env.AMV_KV.put(SPREV_CACHE_KEY, body || new ArrayBuffer(0), { expirationTtl: body ? SPREV_TTL : SPREV_MISS_TTL });
  } catch (e) {}
  if (!body) return new Response('no preview', { status: 404 });
  return send(body, type);
}
