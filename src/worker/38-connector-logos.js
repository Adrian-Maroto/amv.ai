/* ══════════════════════════════════════════════════════════════════════════
   A CONNECTOR'S LOGO, FETCHED BY US AND NOT BY THE VISITOR'S BROWSER.

   The directory showed a letter in a coloured square for every entry, which
   is what a directory looks like before somebody finishes it. The registry
   publishes no logo, so the only real source is where the code lives: an id
   of the form `io.github.<user>/<repo>` names a GitHub account, and that
   account has an avatar.

   Pointing thirty `<img>` tags at github.com would have been four lines in
   the page and wrong. Every visitor's browser would then announce itself to
   a third party once per tile, on a screen somebody is only browsing - and
   this product has three suites about not depending on third parties for the
   sake of the people whose network is slow, censored, or simply blocking
   them. So AMV fetches it, caches it, and serves it from its own origin.

   THE THINGS THAT MAKE THIS SAFE TO EXPOSE WITHOUT A CREDENTIAL:

     the URL is DERIVED, never accepted. Only `io.github.<user>` resolves,
     only to `https://github.com/<user>.png`, and the user segment must match
     GitHub's own account grammar. There is no parameter here that names a
     host, which is what stops it being an SSRF hole rather than an allowlist
     it would be somebody's job to keep;

     it is rate limited per IP before anything else happens, like the
     directory it serves;

     the answer is capped, so a URL that turns out to serve a 40MB file is
     refused rather than cached and re-served;

     and a miss is a 404, not a placeholder, because the page already has a
     mark to fall back to and a placeholder would mean every failure looked
     identical to a logo nobody published.

   Cached under a named key for the same reason the directory is: a GET that
   writes is refused by a-link-is-not-a-command unless what it writes is a
   cache. */
const CLOGO_TTL = 60 * 60 * 24 * 14;      // a fortnight; avatars rarely move
const CLOGO_MAX_BYTES = 256 * 1024;
const CLOGO_TIMEOUT = 6000;
const CLOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/* The whole of the URL derivation, in one place with nothing configurable in
   it. Returns null for anything it does not recognise, which is a 404. */
function _connectorLogoSource(id) {
  const m = String(id || '').match(/^io\.github\.([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\//);
  if (!m) return null;
  return 'https://github.com/' + m[1] + '.png?size=128';
}

async function connectorLogo(request, env) {
  const u = new URL(request.url);
  const ip = _rlIp(request);
  const gate = await guardAction(env, `clogo:${ip}`, 120, 3000, 'connector logos');
  if (gate) return gate;

  const id = _mcpRegText(u.searchParams.get('id'), 140);
  const src = _connectorLogoSource(id);
  if (!src) return new Response('no logo', { status: 404 });

  /* Named `..._CACHE_KEY`, and not for readability. A GET that writes is
     refused by a-link-is-not-a-command unless what it writes is a named cache
     key - that rule is the whole reason this endpoint is allowed to be a GET,
     and it reads the variable name to decide. */
  const CLOGO_CACHE_KEY = 'clogo:' + encodeURIComponent(id);
  /* AND THE KEY'S OWN SHAPE IS CHECKED HERE, where it is used.

     `id` came from the query string. It has already been bounded by
     `_mcpRegText` and then refused outright by `_connectorLogoSource` unless
     it is `io.github.<user>/...`, so nothing unexpected can reach this line -
     which is exactly the argument a-key-is-not-whatever-somebody-sent
     declines to accept, and is right to. Validation that lives in a helper
     two calls up is validation the next person editing this function cannot
     see, and the check reads the function body for that reason. One line, and
     the shape is stated where the record is named. */
  if (!/^clogo:[A-Za-z0-9._%~-]{1,220}$/.test(CLOGO_CACHE_KEY)) {
    return new Response('no logo', { status: 404 });
  }
  try {
    const hit = await env.AMV_KV.get(CLOGO_CACHE_KEY, 'arrayBuffer');
    if (hit) {
      if (!hit.byteLength) return new Response('no logo', { status: 404 });
      const t = (await env.AMV_KV.get(CLOGO_CACHE_KEY + ':t')) || 'image/png';
      return new Response(hit, { status: 200,
        headers: { 'Content-Type': t, 'Cache-Control': 'public, max-age=604800' } });
    }
  } catch (e) {}

  let body = null, type = 'image/png';
  try {
    const r = await fetchDeadline(src, { headers: { 'Accept': 'image/*' } }, CLOGO_TIMEOUT);
    if (r.ok) {
      const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (CLOGO_TYPES.indexOf(ct) >= 0) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength && buf.byteLength <= CLOGO_MAX_BYTES) { body = buf; type = ct; }
      }
    }
  } catch (e) { /* a miss is a 404 below, which the page already handles */ }

  try {
    /* A MISS IS CACHED TOO, as an empty value. Without it, every entry whose
       account has no avatar is re-fetched by every visitor for ever - the
       expensive case, cached nowhere, which is the one worth caching. */
    await env.AMV_KV.put(CLOGO_CACHE_KEY, body || new ArrayBuffer(0),
                         { expirationTtl: body ? CLOGO_TTL : 60 * 60 * 24 });
    if (body) await env.AMV_KV.put(CLOGO_CACHE_KEY + ':t', type, { expirationTtl: CLOGO_TTL });
  } catch (e) {}

  if (!body) return new Response('no logo', { status: 404 });
  return new Response(body, { status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' } });
}

async function connectorDirectory(request, env) {
  const u = new URL(request.url);
  /* BOUNDED, BECAUSE ANYBODY CAN REACH IT WITHOUT A CREDENTIAL.

     One request here can cause up to six reads of somebody else's server, and
     this route needs no account - which is exactly the combination worth
     hammering. Per IP, like the other public reads, and generous enough that a
     person browsing fifteen categories and then searching never meets it.

     A cached answer costs nothing upstream, but the limit is taken BEFORE the
     cache is consulted on purpose: a cap that a cache hit slips past is a cap
     an attacker only has to guess their way around. */
  const ip = _rlIp(request);
  const gate = await guardAction(env, `connectors:${ip}`, 60, 1500, 'directory searches');
  if (gate) return gate;
  const q = _mcpRegText(u.searchParams.get('q'), 60);
  const cursor = _mcpRegText(u.searchParams.get('cursor'), 200);
  const want = Math.max(1, Math.min(MCPREG_MAX, parseInt(u.searchParams.get('limit'), 10) || 24));
  /* THE KV DIRECTLY, AND THIS IS THE ONE PLACE THAT IS RIGHT.

     Everything else here goes through DB, which is what lets a deployment run
     on D1 or on KV from the same code. A cache is the exception and for a
     mechanical reason: the only thing that makes this safe is that it expires,
     `expirationTtl` is a KV feature, and the D1 path would write rows nothing
     ever prunes - a cache that never goes stale is not a cache, it is a stale
     copy of somebody else's catalogue kept for ever.

     Named `..._CACHE_KEY` on purpose. A GET that writes is refused by
     a-link-is-not-a-command unless the thing it writes is a named cache key,
     and that rule is the reason this endpoint is allowed to be a GET at all. */
  const MCPREG_CACHE_KEY = 'mcpcat:' + encodeURIComponent(q) + ':' + encodeURIComponent(cursor) + ':' + want;
  try {
    const hit = await env.AMV_KV.get(MCPREG_CACHE_KEY);
    if (hit) return json(JSON.parse(hit), 200, { 'Cache-Control': 'public, max-age=1800' });
  } catch (e) {}

  const out = [];
  let next = cursor;
  let read = 0;
  try {
    /* Kept reading until there is a page's worth, because filtering to what the
       bridge can run drops most of what comes back - one upstream page can
       yield two entries, and answering with two would look like the directory
       is nearly empty when it is not. Bounded, so a search matching nothing
       cannot walk the whole registry. */
    while (out.length < want && read < MCPREG_PAGES) {
      read++;
      const url = MCPREG_BASE + '?limit=100&version=latest'
        + (q ? '&search=' + encodeURIComponent(q) : '')
        + (next ? '&cursor=' + encodeURIComponent(next) : '');
      /* Through the wrapper, not a bare fetch. `fetchDeadline` is what every
         outbound call in this file uses and what a-redirect-is-not-a-way-
         around-the-gate sweeps for - a deadline written inline here would be a
         correct one that the sweep cannot see, which is the same thing as not
         having one the day somebody edits it. */
      const r = await fetchDeadline(url, { headers: { 'Accept': 'application/json' } }, MCPREG_TIMEOUT);
      if (!r.ok) throw new Error('registry ' + r.status);
      const d = await r.json();
      const list = Array.isArray(d && d.servers) ? d.servers : [];
      for (const rec of list) {
        const m = _mcpRegMap(rec);
        /* One entry per server id. The registry keeps every version, so an
           unfiltered page is the same connector five times. */
        if (m && !out.some((x) => x.id === m.id)) out.push(m);
        if (out.length >= want) break;
      }
      next = (d && d.metadata && d.metadata.nextCursor) || '';
      if (!next || !list.length) break;
    }
  } catch (e) {
    /* Named, never swallowed into an empty list. "No connectors found" and "the
       directory could not be reached" are different facts, and showing the
       first when the second is true tells somebody this product connects to
       nothing.

       200 AND `ok:false`, NOT A 5XX, and the distinction is the point. A 5xx
       means this server is broken: it is what alerting counts, what an error
       budget is spent on, and what somebody gets paged for. AMV is not broken
       here - an OPTIONAL third party is unreachable, and AMV answered that
       question correctly and at once. Reporting somebody else's outage as our
       own crash is how a monitor becomes a thing people learn to ignore, and
       the-first-session is the suite that noticed: it watches for any 5xx
       across a whole first visit, and fifteen category rows on a machine that
       cannot reach the registry made forty-five of them.

       Nothing is swallowed by it: the code travels, the screen names it, and
       the retry is on the screen. The client branches on `ok` and on `code`,
       never on the list being empty. */
    return json({ ok: false, error: 'The connector directory could not be reached.',
                  code: 'directory_unreachable' });
  }

  const body = { ok: true, servers: out, cursor: out.length >= want ? next : '', q };
  try { await env.AMV_KV.put(MCPREG_CACHE_KEY, JSON.stringify(body), { expirationTtl: MCPREG_TTL }); } catch (e) {}
  return json(body, 200, { 'Cache-Control': 'public, max-age=1800' });
}

const SHARE_MAX_BYTES = 512 * 1024;
const SHARE_MAX_MSGS = 400;
/* AMV-055: AN IDENTIFIER THAT IS THE PERMISSION HAS TO BE UNGUESSABLE.

   A share link is a bearer capability: whoever has the id can read the
   conversation, and there is nothing else to check, because the whole point is
   that it works for somebody with no account. So the id is the password, and it
   was about fifty bits long.

   Not because the source was weak - it was crypto.getRandomValues - but because
   the ENCODING threw most of it away. Nine random bytes were rendered as
   `b.toString(36).padStart(2,'0')`, two characters per byte, and then cut to
   fourteen characters: seven bytes' worth. Worse, the first character of each
   pair could only ever be 0-7, because 255 in base 36 is "73". So the alphabet
   looked like 36 and half the positions carried three bits.

   This helper takes the bytes and maps them onto the alphabet evenly, with
   rejection rather than a modulo - a modulo over 256 would make the first few
   characters of the alphabet more likely than the rest, which is the same class
   of mistake one level down. Twenty-two characters of base 36 is over a hundred
   and thirteen bits, which is not guessable by anyone. */
const _ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function _randId(len) {
  const n = Math.max(1, len | 0);
  const out = [];
  /* 252 is the largest multiple of 36 under 256. Anything above it is thrown
     away and redrawn, so every character is equally likely. */
  const LIMIT = 252;
  while (out.length < n) {
    const buf = new Uint8Array(n * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < n; i++) {
      if (buf[i] >= LIMIT) continue;
      out.push(_ID_ALPHABET[buf[i] % 36]);
    }
  }
  return out.join('');
}
const _shareId = () => _randId(22);
/* The shape a share id may have, in one place because it is checked at three.
   The upper bound moved from 20 to 32 when the id grew to 22 characters
   (AMV-055) - and the old bound is why it moved rather than being deleted:
   this is a KV key built from something a stranger sends, so a ceiling on its
   length is doing real work. Ids issued before the change are 14 characters
   and still match, so no existing link stopped working. */
const SHARE_ID_RE = /^[a-z0-9]{6,32}$/;
function _shareEsc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function shareCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const blocked = await guardAction(env, `share:${user.email}`, 10, 100, 'shares');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const title = String(body.title || 'Shared conversation').slice(0, 200);
  const msgs = Array.isArray(body.msgs) ? body.msgs.slice(0, SHARE_MAX_MSGS) : null;
  if(!msgs || !msgs.length) return json({ error:'nothing to share' }, 400);
  const clean = msgs.map(m => ({
    r: m && m.r === 'u' ? 'u' : 'a',
    c: String((m && m.c) || '').slice(0, 20000),
  })).filter(m => m.c);
  if(!clean.length) return json({ error:'nothing to share' }, 400);
  /* AMV-086: whether this page may appear in search results.

     A shared conversation that search engines index is a real acquisition
     channel - it is how link-sharing turns into traffic. It is also permanent
     in a way a link is not: once a page is in an index, revoking it does not
     un-publish the snippet someone already saw, and most people sharing a link
     with one person do not expect it to become a search result.

     So the growth is opt-in, never a default. The person who wants reach says
     so; everyone else gets a link that works exactly as they assumed. */
  const listed = body.listed === true;
  const rec = { title, msgs: clean, owner: user.email.toLowerCase(), at: Date.now(), listed };
  if(JSON.stringify(rec).length > SHARE_MAX_BYTES)
    return json({ error:'This conversation is too large to share.', code:'share_too_large' }, 413);
  const id = _shareId();
  await DB.put(env, 'share', id, rec);
  // Owner index, so the privacy screen can actually list and revoke them.
  /* Under the lock revoking takes. Creating read this list, put a new entry on
     the front and wrote the whole thing back - so a revocation landing in that
     window is undone, and a link somebody was told had stopped working is back
     in their index and still live. That is the direction this must never fail
     in, which is why both sides of it now hold the same lock. */
  await _withKind(env, 'shares', rec.owner, (mine) => {
    if(!mine) return;
    mine.items = [{ id, title, at: rec.at, listed }, ...(mine.items || [])].slice(0, 200);
  }, { items: [] });
  audit(env, 'share_created', { by: user.email, id, listed });
  /* The page is served by this server, not by the static host - so the link is
     this server's public address (under /api on the site's own host), never
     APP_URL, where /c/ is the static host's 404. */
  return json({ ok:true, id, listed, url: _publicOrigin(request) + '/c/' + id });
}
async function shareList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const mine = (await DB.get(env, 'shares', user.email.toLowerCase())) || { items: [] };
  return json({ ok:true, items: (mine.items||[]).map(i => ({ ...i, url: _publicOrigin(request) + '/c/' + i.id })) });
}
/* POST /v1/share/list already reports `listed`. This lets an owner take a page
   back OUT of search without deleting it - the decision has to be reversible or
   it is not really a choice. Putting it back IN is the same call the other way.
   Note what this cannot do: un-publish something already indexed. The copy at
   the point of choosing says so, because that is when it matters. */
async function shareVisibility(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  const id = String(body.id||'');
  if(!SHARE_ID_RE.test(id)) return json({ error:'bad id' }, 400);
  const rec = await DB.get(env, 'share', id);
  if(!rec || rec.owner !== user.email.toLowerCase()) return json({ error:'not found' }, 404);
  const listed = body.listed === true;
  rec.listed = listed;
  await DB.put(env, 'share', id, rec);
  /* Same lock, same reason: this rewrote the whole index to change one flag,
     so a share created or revoked in between was undone by it. */
  await _withKind(env, 'shares', user.email.toLowerCase(), (mine) => {
    if(!mine) return;
    mine.items = (mine.items||[]).map(i => i.id === id ? Object.assign({}, i, { listed }) : i);
  }, { items: [] });
  audit(env, 'share_visibility', { by: user.email, id, listed });
  return json({ ok:true, id, listed });
}

async function shareRevoke(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { id } = await request.json().catch(()=>({}));
  if(!SHARE_ID_RE.test(String(id||''))) return json({ error:'bad id' }, 400);
  const rec = await DB.get(env, 'share', id);
  // Only the owner can revoke, and a missing record is not an error worth
  // leaking - either way the link no longer works for them.
  if(rec && rec.owner === user.email.toLowerCase()) await DB.del(env, 'share', id);
  /* Under the lock, because shareCreate writes this same list. Revoking read
     it, filtered one out and wrote the whole thing back - so a share created
     in that window is erased from the index while its `share:` record lives
     on, and the person has a public URL that no screen of theirs lists. The
     inverse loses the revocation itself, which is worse: content stays
     reachable after somebody was told it had stopped being. */
  await _withKind(env, 'shares', user.email.toLowerCase(), (mine) => {
    if(!mine) return;
    mine.items = (mine.items||[]).filter(i => i.id !== id);
  }, { items: [] });
  audit(env, 'share_revoked', { by: user.email, id });
  return json({ ok:true });
}
/* The public page. No auth, no JavaScript, everything escaped. */
async function sharePage(request, env, id){
  const notFound = (msg) => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">' +
    '<title>Not available - AMV.AI</title>' +
    '<div style="font:15px/1.6 system-ui;padding:60px 24px;max-width:600px;margin:auto;text-align:center">' +
    '<h1 style="font-size:20px">' + _shareEsc(msg) + '</h1>' +
    '<p style="color:#666">This link may have been revoked by its owner.</p></div>',
    { status: 404, headers: { 'Content-Type':'text/html; charset=utf-8', 'X-Robots-Tag':'noindex, nofollow' } });

  if(!SHARE_ID_RE.test(String(id||''))) return notFound('That link is not valid');
  const rec = await DB.get(env, 'share', id);
  if(!rec) return notFound('This conversation is no longer shared');
  /* Anything created before this choice existed was created under a promise of
     "not indexed". It keeps that promise: only an explicit true opts in. */
  const listed = rec.listed === true;

  const base = (env.APP_URL || '').replace(/\/$/, '') || new URL(request.url).origin;
  // Only offered when an address is actually configured - a Report link that
  // goes nowhere is worse than none.
  const reportTo = String(env.SUPPORT_EMAIL || '').trim();
  const title = _shareEsc(rec.title || 'Shared conversation');
  // The preview description is the opening question, which is what makes a
  // shared link worth clicking.
  const first = (rec.msgs.find(m => m.r === 'u') || rec.msgs[0] || {}).c || '';
  const desc = _shareEsc(String(first).replace(/\s+/g, ' ').slice(0, 180));
  const turns = rec.msgs.map(m =>
    '<div class="m ' + (m.r === 'u' ? 'u' : 'a') + '">' +
      '<div class="who">' + (m.r === 'u' ? 'Asked' : 'AMV') + '</div>' +
      '<div class="t">' + _shareEsc(m.c) + '</div></div>').join('');

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' - AMV.AI</title>' +
    '<meta name="description" content="' + desc + '">' +
    (listed ? '' : '<meta name="robots" content="noindex,nofollow">') +
    // The tags that make a pasted link render as a card instead of a bare URL.
    '<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="AMV.AI">' +
    '<meta property="og:title" content="' + title + '">' +
    '<meta property="og:description" content="' + desc + '">' +
    '<meta property="og:url" content="' + _shareEsc(_publicOrigin(request) + '/c/' + id) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + title + '">' +
    '<meta name="twitter:description" content="' + desc + '">' +
    '<style>' +
    ':root{color-scheme:light dark}' +
    'body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;background:#0d0d0f;color:#e8e8ea}' +
    '@media(prefers-color-scheme:light){body{background:#fbfbfc;color:#18181b}.m.a{background:#fff;border-color:#e6e6ea}.m .who{color:#666}}' +
    '.wrap{max-width:720px;margin:0 auto;padding:28px 20px 64px}' +
    '.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:28px;flex-wrap:wrap}' +
    '.brand{font-weight:700;letter-spacing:-.02em}' +
    '.cta{display:inline-block;padding:8px 18px;border-radius:999px;background:#5590ff;color:#fff;text-decoration:none;font-size:14px;font-weight:500}' +
    'h1{font-size:23px;line-height:1.3;margin:0 0 22px}' +
    '.m{margin:0 0 14px;padding:13px 16px;border:1px solid #26262b;border-radius:12px;background:#141418}' +
    '.m.u{background:none;border-style:dashed}' +
    '.who{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8a8a92;margin-bottom:6px}' +
    '.t{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}' +
    '.foot{margin-top:34px;padding-top:20px;border-top:1px solid #26262b;font-size:13.5px;color:#8a8a92}' +
    '.foot a{color:#5590ff}' +
    '</style></head><body><div class="wrap">' +
    '<div class="top"><span class="brand">AMV.AI</span>' +
    '<a class="cta" href="' + _shareEsc(base) + '">Try AMV free</a></div>' +
    '<h1>' + title + '</h1>' + turns +
    /* Two things this footer has to do. Sell AMV - and be straight about what
       the page is. The transcript was uploaded by whoever made the link; AMV
       cannot verify that it is unedited, so the page must not present it as
       AMV vouching for the content, and there must be a way to report it. That
       reporting route is what makes a takedown possible at all. */
    '<div class="foot">Shared by an AMV user. AMV.AI hosts this page but does not verify or endorse its contents. ' +
    '<a href="' + _shareEsc(base) + '">Try AMV free</a>' +
    (reportTo ? ' &middot; <a href="mailto:' + _shareEsc(reportTo) +
      '?subject=' + encodeURIComponent('Report shared page ' + id) + '">Report this page</a>' : '') +
    '</div>' +
    '</div></body></html>';

  return new Response(html, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    /* Short, and revalidated. A shared page is revoked from the privacy screen
       the moment someone changes their mind, and a five-minute public cache
       meant the link kept working after the app had told them it was dead.
       Sixty seconds still absorbs the burst a link gets when it is posted. */
    'Cache-Control': 'public, max-age=60, must-revalidate',
    ...(listed ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // No scripts at all: this page renders text AMV produced, to strangers.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}

