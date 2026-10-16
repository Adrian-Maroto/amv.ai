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

/* ═══════════════════════════════════════════════════════════════════════
   SCHOOL: READING CANVAS, AND THE DOC AN ASSIGNMENT IS ACTUALLY ABOUT.

   AMV had a Canvas feature that could never have worked for anybody. It called
   `yourschool.instructure.com/api/v1/...` FROM THE BROWSER, and the page's
   Content-Security-Policy names every host AMV may reach - Google, GitHub,
   Slack, Stripe. No school's Canvas host is on it and none can be, because the
   host is different for every school. So the browser refused the request before
   it left, on every run, for every student.

   Reading it here instead is the only way that works: a Worker has no CSP. It
   also means the token stops living only in a browser tab, and erasure can
   reach it - a school token in localStorage is a credential AMV promised to
   delete and had no way to.

   The second half of the same dead end: an assignment that says "make a copy of
   this doc" carries the doc as a LINK, and the old code ran the description
   through `.replace(/<[^>]*>/g,' ')` before anything read it. That strips tags,
   and the link lives inside one - so the single thing the assignment is about
   was deleted before the model ever saw it. Links are pulled out first now, and
   kept.

   What AMV does NOT do here is hand anything in. It reads, it copies, it shares
   when the student says to. Submitting stays the student's own action, which is
   the same boundary the Classroom scopes already draw. */

/* A school's Canvas host. Public https only - the SSRF gate above - and it must
   look like a host rather than a path, because "base URL" is the field somebody
   pastes a whole assignment link into. */
function _canvasBase(raw){
  const gate = _webHostAllowed(String(raw || '').trim().replace(/\/+$/, ''));
  if(!gate.ok) return { ok:false, why:gate.why };
  const u = new URL(gate.url);
  if(u.protocol !== 'https:') return { ok:false, why:'A school Canvas address has to be https.' };
  if(u.pathname && u.pathname !== '/') return { ok:false, why:'Use just the address of your school\u2019s Canvas, like https://yourschool.instructure.com - not a link to one page.' };
  return { ok:true, base:'https://' + u.hostname };
}

/* Where a Google Doc, Sheet or Slide deck lives in an assignment. Kept as the
   id AND the original link, because the id is what Drive needs and the link is
   what a person recognises. */
const _DOC_LINK = /https?:\/\/(?:docs|drive)\.google\.com\/(?:(document|spreadsheets|presentation)\/d\/|file\/d\/|open\?id=)([A-Za-z0-9_-]{10,})/g;
const _DOC_KIND = { document:'doc', spreadsheets:'sheet', presentation:'slides' };
function _docLinksFrom(html){
  const out = []; const seen = new Set();
  const text = String(html || '');
  let m;
  _DOC_LINK.lastIndex = 0;
  while((m = _DOC_LINK.exec(text))){
    const id = m[2];
    if(seen.has(id)) continue;
    seen.add(id);
    out.push({ id, kind: _DOC_KIND[m[1]] || 'file', url: m[0] });
  }
  return out;
}

/* The instructions as a person reads them: tags gone, but the LINKS named
   rather than deleted, so what the assignment is about survives the stripping
   that used to destroy it. */
function _assignmentText(html){
  const links = _docLinksFrom(html);
  let t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if(links.length){
    t += '\n\nAttached ' + (links.length === 1 ? 'document' : 'documents') + ':\n'
       + links.map(l => '- ' + l.kind + ': ' + l.url).join('\n');
  }
  return t;
}

/* The stored connection. Kept server-side so the token is not only in a browser
   tab, so erasure can reach it, and so a request does not carry it every time. */
/* AMV-014: the token comes back out here and nowhere else, so every consumer
   keeps reading `rec.token` and no call site had to learn about encryption.
   A record written before this change still carries a plaintext `token`; it is
   honoured so an existing connection does not silently stop working, and it is
   re-encrypted on the next connect. */
const _loadSchool = async (env, em) => {
  const rec = await DB.get(env, 'school', em);
  if (!rec) return null;
  if (rec.secret) {
    const token = await _mailDecrypt(env, rec.secret);
    if (!token) return null;
    return { ...rec, token };
  }
  return rec;
};

async function schoolConnect(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'Please sign in.' }, 401);
  /* This route makes AMV fetch a host the CALLER named. Unbounded, that is a
     way to have the operator's Workers budget hammer any address on the
     internet, as often as somebody likes, from AMV's own IP - and it was
     unbounded, because the rule that checks for this knew third parties by
     name and had never heard of a school. */
  const cg = await guardAction(env, `schoolconn:${user.email}`, 5, 40, 'connecting a school');
  if(cg) return cg;
  const body = await request.json().catch(()=>({}));
  const gate = _canvasBase(body.baseUrl);
  if(!gate.ok) return json({ error:gate.why, code:'bad_base' }, 400);
  const token = String(body.token || '').trim();
  if(token.length < 20) return json({ error:'That does not look like a Canvas access token. Generate one in Canvas under Account \u2192 Settings \u2192 New Access Token.', code:'bad_token' }, 400);

  /* Proved before it is stored. Saving a token that does not work and telling
     somebody they are connected is the failure this whole area is full of. */
  let who;
  try{
    const out = await fetchGuarded(gate.base + '/api/v1/users/self', { headers:{ Authorization:'Bearer ' + token } });
    if(out.blocked){
      audit(env, 'school_connect_blocked', { email:user.email, why:out.why });
      return json({ error:'That address sent AMV somewhere it is not allowed to go, so nothing was saved. ' + out.why, code:'blocked_url' }, 400);
    }
    const r = out.response;
    if(r.status === 401 || r.status === 403)
      return json({ error:'Canvas did not accept that token. Check it was copied whole, and that it has not expired.', code:'canvas_auth' }, 400);
    if(!r.ok) return json({ error:'Your school\u2019s Canvas answered ' + r.status + '. Check the address is right.', code:'canvas_error' }, 502);
    who = await r.json().catch(()=>({}));
  }catch(e){
    return json({ error:'AMV could not reach that address. Check it is your school\u2019s Canvas address.', code:'canvas_unreachable' }, 502);
  }
  /* AMV-014: encrypted at rest, the same way a mailbox password and a bot
     token are. This was stored in the clear, which made every copy of the
     record - a backup, a log, a storage dump - a copy of a working credential.
     Refusing when there is no key is the honest failure: storing it plainly
     "for now" is how it stays plain. */
  const enc = await _mailEncrypt(env, token);
  if (!enc) {
    return json({ error: 'AMV cannot store a school token safely on this deployment yet, so it will not store one at all. MAIL_CRED_KEY has to be set first, to a long random value - at least 24 characters of real randomness, not a phrase.',
                  code: 'needs_service' }, 503);
  }
  await DB.put(env, 'school', user.email, { base: gate.base, secret: enc, name: who && who.name, at: Date.now() });
  audit(env, 'school_connected', { email:user.email, host:new URL(gate.base).hostname });
  return json({ ok:true, name: (who && who.name) || '', host: new URL(gate.base).hostname });
}

async function schoolDisconnect(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'Please sign in.' }, 401);
  const dg = await guardAction(env, `schooloff:${user.email}`, 10, 60, 'disconnecting your school');
  if(dg) return dg;
  await DB.del(env, 'school', user.email);
  audit(env, 'school_disconnected', { email:user.email });
  return json({ ok:true });
}

/* One door to Canvas. Every call goes through here so the token is attached in
   one place, the host is re-checked on every request rather than trusted
   because it was checked once, and a refusal comes back as a sentence. */
async function _canvasGet(env, rec, path){
  const gate = _canvasBase(rec.base);
  if(!gate.ok) return { error:gate.why, status:400 };
  const url = gate.base + '/api/v1/' + String(path || '').replace(/^\/+/, '');
  /* Through the guarded fetch, not a bare one. The address here is whatever a
     student typed on the connect screen, so it is exactly the case the SSRF
     gate exists for - and a bare fetch would follow a redirect out of that
     host, carrying the Canvas token with it, past a gate that had already
     said yes to the first hop. It also gets a deadline: a school that accepts
     the connection and never answers used to hold the request open until the
     platform killed it. */
  let r;
  try{
    const out = await fetchGuarded(url, { headers:{ Authorization:'Bearer ' + rec.token } });
    if(out.blocked){
      audit(env, 'school_fetch_blocked', { host:new URL(gate.base).hostname, why:out.why });
      return { error:'Your school\u2019s address sent AMV somewhere it is not allowed to go, so nothing was read. ' + out.why, status:400, code:'blocked_url' };
    }
    r = out.response;
  }
  catch(e){ return { error:'AMV could not reach your school\u2019s Canvas just now.', status:502 }; }
  if(r.status === 401 || r.status === 403)
    return { error:'Canvas refused that request. Your access token may have expired - reconnect it in Settings.', status:401, code:'canvas_auth' };
  if(!r.ok) return { error:'Canvas answered ' + r.status + '.', status:502 };
  /* AMV-050: NOT `await r.json()`.
     The host on the other end of this is whatever a student typed on the
     connect screen. `r.json()` reads the whole body into memory first and only
     then finds out how big it was, so a school - or something pretending to be
     one, or a real Canvas having a bad day - answering with half a gigabyte was
     an instruction to buffer half a gigabyte inside a Worker that has 128MB.
     Read with a ceiling instead, and stop at it rather than after it. */
  const body = await _readCapped(r, SCHOOL_MAX_BYTES).catch(() => ({ failed:true }));
  if(body.failed) return { error:'AMV could not read what your school’s Canvas sent.', status:502 };
  if(body.tooBig){
    audit(env, 'school_response_too_big', { host:new URL(gate.base).hostname, bytes:body.bytes });
    return { error:'Your school’s Canvas sent more in one answer than AMV will read, so nothing was read from it.',
             status:502, code:'canvas_too_big' };
  }
  let data = null;
  try{ data = JSON.parse(body.text); }catch(e){ data = null; }
  if(data == null) return { error:'Canvas sent something AMV could not read.', status:502 };
  return { data };
}

/* Read a response body with a ceiling, stopping AT it rather than after it.

   The Content-Length is checked first because it is free, and then the stream
   is counted anyway - a length header is a claim by the same server whose size
   is in question, and a chunked response has no length at all. */
async function _readCapped(r, max){
  const claimed = Number(r.headers && r.headers.get && r.headers.get('content-length'));
  if(Number.isFinite(claimed) && claimed > max) return { tooBig:true, bytes:claimed };
  if(!r.body || typeof r.body.getReader !== 'function'){
    const t = await r.text();
    return t.length > max ? { tooBig:true, bytes:t.length } : { text:t };
  }
  const reader = r.body.getReader();
  const chunks = [];
  let n = 0;
  for(;;){
    const { value, done } = await reader.read();
    if(done) break;
    if(!value) continue;
    n += value.length;
    if(n > max){
      /* Cancelled, so the connection closes instead of continuing to arrive
         while nobody is reading it. */
      try{ await reader.cancel(); }catch(e){}
      return { tooBig:true, bytes:n };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(n);
  let at = 0;
  for(const c of chunks){ buf.set(c, at); at += c.length; }
  return { text: new TextDecoder().decode(buf) };
}

/* What is due, with the documents an assignment points at KEPT rather than
   stripped out of it. */
async function schoolWork(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'Please sign in.' }, 401);
  /* One call here fans out to a course list plus one request per course, so
     it is up to nine outbound requests to somebody else's server every time
     it is pressed. Bounded per account: the cost of an unbounded version is
     paid by the operator and by the school. */
  const wg = await guardAction(env, `schoolwork:${user.email}`, 12, 300, 'reading your school work');
  if(wg) return wg;
  const rec = await _loadSchool(env, user.email);
  if(!rec) return json({ connected:false,
