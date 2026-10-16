/* ══════════════════════════════════════════════════════════════
   OUTBOUND REQUESTS: A DEADLINE, AND A GATE THAT SURVIVES A REDIRECT.

   Two things every fetch out of this Worker was missing.

   NO DEADLINE. There were 41 outbound fetches here and not one AbortSignal
   between them. The browser half of AMV has had fetchDeadline for as long as
   it has had a network call; the server half had nothing. A provider that
   accepts the connection and then says nothing holds the request until the
   platform kills it, and on the model path the caller's allowance is reserved
   the whole time - so a third party being slow costs the customer their quota
   and costs the operator the wall clock. Worst at a route that fetches a host
   the CALLER chose: point it at a black hole and the Worker waits.

   THE GATE ONLY GUARDED THE FIRST HOP. _webHostAllowed refuses localhost, the
   RFC1918 ranges, 169.254, the metadata host - and it was checked once,
   against the address somebody typed. fetch follows redirects by default, so
   a server that answers 302 http://169.254.169.254/ was followed with no
   second look, which is the whole gate walked around by one response header.
   Workers also forward the Authorization header across origins where a
   browser strips it, so the redirect takes the credential with it.

   So: hops are followed by hand, each one re-gated, and the credential is
   dropped the moment the origin changes. A redirect that leaves the origin is
   a different server, and it does not get to keep the key that was meant for
   the first one. */
const OUTBOUND_TIMEOUT_MS = 15000;
const OUTBOUND_MAX_HOPS = 5;

/* THE ONE EXEMPTION, STATED RATHER THAN LEFT IMPLICIT.

   _modelFetch is not wrapped. Aborting a signal aborts the response body too,
   so a deadline on a streamed answer does not bound a hang - it cuts the
   sentence somebody is reading, at a time that has nothing to do with whether
   anything is wrong. A chat that stops mid-word at fifteen seconds is a worse
   failure than the one this exists to prevent, and it would happen to every
   long answer rather than to the rare hung request. That call already accepts
   a caller's own signal, and the platform bounds the request either way. */

/* A fetch that cannot hang. Everything else here goes through it. */
function fetchDeadline(url, init, ms){
  return fetch(url, Object.assign({}, init || {}, {
    signal: AbortSignal.timeout(Math.max(1000, +ms || OUTBOUND_TIMEOUT_MS)),
  }));
}

/* A fetch to an address somebody else chose. Every hop is re-gated, and the
   Authorization header does not cross an origin boundary. */
async function fetchGuarded(rawUrl, init, ms){
  let target = String(rawUrl || '');
  let opts = Object.assign({}, init || {});
  const firstOrigin = (() => { try { return new URL(target).origin; } catch(e){ return ''; } })();
  for(let hop = 0; hop <= OUTBOUND_MAX_HOPS; hop++){
    const gate = _webHostAllowed(target);
    if(!gate.ok) return { blocked: true, why: gate.why, url: target, hop };
    const r = await fetchDeadline(gate.url, Object.assign({}, opts, { redirect: 'manual' }), ms);
    if(!(r.status >= 300 && r.status < 400)) return { blocked: false, response: r };
    const loc = r.headers.get('location');
    if(!loc) return { blocked: false, response: r };
    let next; try { next = new URL(loc, gate.url).toString(); } catch(e){ return { blocked: false, response: r }; }
    /* Leaving the origin the credential was issued for: the credential stays
       behind. A 302 is not a reason to hand somebody else's server a token. */
    let nextOrigin = ''; try { nextOrigin = new URL(next).origin; } catch(e){}
    if(nextOrigin !== firstOrigin && opts.headers){
      const h = {};
      for(const [k, v] of Object.entries(opts.headers)){
        if(!/^authorization$/i.test(k) && !/^cookie$/i.test(k)) h[k] = v;
      }
      opts = Object.assign({}, opts, { headers: h });
    }
    target = next;
  }
  return { blocked: true, why: 'That address redirected too many times.', url: target, hop: OUTBOUND_MAX_HOPS };
}

/* Same ORIGIN, decided by parsing rather than by comparing strings.

   Scheme, host and port each become a field of their own, so nothing in one of
   them can reach across into another - which is the whole failure a prefix
   comparison has. `https://amv.homes.evil.co` and `https://amv.homes@evil.co`
   both start with `https://amv.homes` and neither is it.

   A path is deliberately not part of the comparison: a callback lives at a path
   under the origin, and that is the normal case. */
function _sameOrigin(a, b){
  try {
    const x = new URL(String(a));
    const y = new URL(String(b));
    /* A URL carrying credentials is refused outright rather than compared. It
       has no legitimate use in a redirect target and it exists in this shape
       for exactly one reason. */
    if (x.username || x.password) return false;
    return x.origin === y.origin && x.origin !== 'null';
  } catch (e) { return false; }
}

/* SSRF gate: only public http(s). Re-checked on every navigation, and on every
   hop of a redirect chain - see fetchGuarded above. */
function _webHostAllowed(raw){
  let u; try{ u = new URL(String(raw)); }catch(e){ return { ok:false, why:'That is not a valid URL.' }; }
  if(u.protocol !== 'http:' && u.protocol !== 'https:') return { ok:false, why:'Only http and https are allowed.' };
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local'))
    return { ok:false, why:'Internal hosts are not reachable from the agent.' };
  if(h === 'metadata.google.internal') return { ok:false, why:'Blocked host.' };
  /* The v4 ranges, factored out because IPv6 can carry an IPv4 address inside
     it and has to reach exactly the same verdict. */
  const v4Blocked = (a, b) =>
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(v4 && v4Blocked(+v4[1], +v4[2]))
    return { ok:false, why:'That address range is blocked (internal network).' };

  /* IPv6 CAN CARRY A BLOCKED IPv4 ADDRESS INSIDE IT.

     The literal checks below catch ::1, fc00::/7 and fe80::/10, and the dotted
     forms are normalised by `new URL` before they get here - it canonicalises
     2130706433, 0177.0.0.1 and 127.1 all to 127.0.0.1, which is why those never
     reached this far. What it does NOT do is flatten an IPv4-MAPPED address:

         http://[::ffff:169.254.169.254]/   ->  hostname [::ffff:a9fe:a9fe]

     That is the cloud metadata service, and it walked straight through - it is
     not ::1, does not start with fc, fd or fe80, and is not a dotted quad. So
     did [::] , which routes to the local host, and the NAT64 prefix 64:ff9b::,
     which exists specifically to carry v4 addresses over v6.

     The last 32 bits are pulled out of any address that embeds an IPv4 one and
     run through the same table. */
  if(h.includes(':')){
    if(h === '::' || h === '::1') return { ok:false, why:'That address range is blocked (internal network).' };
    if(h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))
      return { ok:false, why:'That address range is blocked (internal network).' };
    const embedsV4 = /^::ffff:/i.test(h) || /^64:ff9b:/i.test(h) || /^::/.test(h);
    if(embedsV4){
      /* Either tail form: ::ffff:127.0.0.1 or its canonical ::ffff:7f00:1 */
      const dotted = h.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if(dotted && v4Blocked(+dotted[1], +dotted[2]))
        return { ok:false, why:'That address range is blocked (internal network).' };
      const hexTail = h.match(/([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if(hexTail){
        const hi = parseInt(hexTail[1], 16), lo = parseInt(hexTail[2], 16);
        if(v4Blocked((hi >> 8) & 255, hi & 255)) 
          return { ok:false, why:'That address range is blocked (internal network).' };
        /* ::ffff:0:1 style, where the whole v4 sits in the low word. */
        if(hi === 0 && v4Blocked((lo >> 8) & 255, lo & 255))
          return { ok:false, why:'That address range is blocked (internal network).' };
      }
    }
  }
  return { ok:true, url:u.toString() };
}

