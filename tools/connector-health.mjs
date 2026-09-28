/* IS EVERY CONNECTOR STILL THERE?

   A connector breaks without AMV changing a line. An app moves its connector to
   a new address, drops the sign-in document AMV discovers it from, or stops
   letting a new client register; a mail provider retires an IMAP host. Nothing
   in the test suite can see that, because the suites run against stand-ins -
   and they have to, since a test that depends on forty companies' servers
   being up is a test that fails for reasons nobody here can fix. So the
   Connect button keeps drawing, somebody presses it, and it fails at the one
   moment it was wanted.

   This asks the real servers, read-only, the same first questions the Worker
   asks when somebody presses Connect:

   - every remote app (REMOTE_APPS): does the address answer, does it say where
     to sign in (RFC 9728 / RFC 8414, the same order _rmcpDiscover tries), is
     there an authorize, token AND registration endpoint, and is PKCE S256
     allowed. Nothing is registered - registering would leave a client called
     AMV in forty companies' lists every day.
   - every sign-in provider (CONN_PROVIDERS): do its authorize and token hosts
     still exist and answer on the addresses AMV sends people to.
   - every mailbox (MAIL_PROVIDERS): does the IMAP host answer TLS on the port
     the Worker uses, with an IMAP greeting.

   Nothing here logs in, sends, or stores anything. Each probe gets a second
   try, because one dropped packet is not a broken connector.

   Run: node tools/connector-health.mjs [--only=remote|oauth|mail] [--json]
   Exit 0 when every connector answered, 1 with the list of the ones that did
   not. Runs daily on GitHub (.github/workflows/connectors.yml), where the
   network is open; a sandboxed laptop may see a proxy refuse the hosts. */
import { readFileSync } from 'fs';
import { connect as tlsConnect } from 'tls';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const JSON_OUT = args.includes('--json');

/* The tables are read out of the Worker's own source, so this cannot drift
   from what the product really offers. Each is a plain object literal of
   strings; it is evaluated on its own, never the Worker. */
function table(name) {
  const i = SRC.indexOf('const ' + name + ' = {');
  if (i < 0) throw new Error(name + ' not found in amv-backend.js');
  let depth = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return (0, eval)('(' + SRC.slice(j, k + 1) + ')');
  }
  throw new Error(name + ' is not closed');
}
function constant(name) {
  const m = SRC.match(new RegExp('const ' + name + '\\s*=\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
}

const PROTO = (SRC.match(/const RMCP_PROTOCOL = '([^']+)'/) || [])[1] || '2025-06-18';
const timeout = (ms) => AbortSignal.timeout(ms);
async function twice(fn) {
  const a = await fn();
  if (a.ok) return a;
  await new Promise(r => setTimeout(r, 1500));
  const b = await fn();
  return b.ok ? b : { ...b, why: b.why || a.why };
}
async function getJSON(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'MCP-Protocol-Version': PROTO }, signal: timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
function wellKnown(base, name) {
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, '');
  return path ? [u.origin + '/.well-known/' + name + path, u.origin + '/.well-known/' + name]
              : [u.origin + '/.well-known/' + name];
}

async function remoteApp(slug, app) {
  let prm = null, init = '';
  try {
    const r = await fetch(app.url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTO },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'AMV', version: '1.0' } } }),
      signal: timeout(10000) });
    init = String(r.status);
    const m = (r.headers.get('www-authenticate') || '').match(/resource_metadata="([^"]+)"/i);
    try { await r.body?.cancel(); } catch (e) {}
    if (m) prm = await getJSON(new URL(m[1], app.url).toString());
  } catch (e) { return { ok: false, why: 'the connector address does not answer (' + String(e.cause?.code || e.name || e.message) + ')' }; }
  if (init === '404' || init === '410') return { ok: false, why: 'the connector address answers ' + init + ' - it has moved' };
  if (!prm) for (const w of wellKnown(app.url, 'oauth-protected-resource')) { prm = await getJSON(w); if (prm) break; }
  const issuer = (prm && Array.isArray(prm.authorization_servers) && prm.authorization_servers[0]) || new URL(app.url).origin;
  let as = null;
  for (const w of [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration')]) {
    const d = await getJSON(w);
    if (d && d.authorization_endpoint && d.token_endpoint) { as = d; break; }
  }
  if (!as) return { ok: false, why: 'no sign-in document at ' + issuer + ' - AMV would guess /authorize and fail' };
  if (!as.registration_endpoint) return { ok: false, why: 'the app no longer lets a new client register itself' };
  const s256 = !Array.isArray(as.code_challenge_methods_supported) || !as.code_challenge_methods_supported.length
    || as.code_challenge_methods_supported.includes('S256');
  if (!s256) return { ok: false, why: 'the app does not allow PKCE S256' };
  return { ok: true, why: 'sign-in at ' + new URL(as.authorization_endpoint).host };
}

const TOKEN_404_UNKNOWN_CLIENT = new Set(['github']);
async function oauthProvider(id, p) {
  for (const [label, url] of [['authorize', p.auth], ['token', p.token]]) {
    if (!url) continue;
    try {
      /* Asked the way each is used: the authorize page is opened, the token
         endpoint is POSTed to. A token endpoint answers a GET with 404 at
         Google, GitHub, Dropbox, Strava and Calendly - the first run of this
         check reported all five as moved, which they were not. */
      const r = label === 'token'
        ? await fetch(url, { method: 'POST', redirect: 'manual', signal: timeout(10000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            /* With a client id, as every real exchange has: GitHub answers a
               token request that names no client with 404, which is "which
               client?", not "moved" - the second run reported it as gone. */
            body: 'grant_type=authorization_code&client_id=amv-connector-health&code=probe' })
        : await fetch(url, { method: 'GET', redirect: 'manual', signal: timeout(10000) });
      try { await r.body?.cancel(); } catch (e) {}
      /* Without a client id an authorize page answers 400 or redirects, and a
         token endpoint refuses the request with 400/401 - all of which prove it
         is there. 404 and 410 say it is gone; 5xx says it is down. */
      /* GitHub answers 404 to a token request from any client it does not
         know - with or without a client id - so from a probe that is not AMV,
         404 there says nothing about the address, which is GitHub's documented
         one. Its sign-in page is still checked above. */
      if (r.status === 404 && label === 'token' && TOKEN_404_UNKNOWN_CLIENT.has(id)) continue;
      if (r.status === 404 || r.status === 410) return { ok: false, why: label + ' answers ' + r.status + ' - it has moved' };
      if (r.status >= 500) return { ok: false, why: label + ' answers ' + r.status };
    } catch (e) { return { ok: false, why: label + ' does not answer (' + String(e.cause?.code || e.name || e.message) + ')' }; }
  }
  return { ok: true, why: new URL(p.auth).host };
}

function imapGreeting(host, port) {
  return new Promise((resolve) => {
    let done = false, buf = '';
    const finish = (v) => { if (!done) { done = true; try { s.destroy(); } catch (e) {} resolve(v); } };
    const s = tlsConnect({ host, port, servername: host, timeout: 10000 }, () => {});
    s.setEncoding('utf8');
    s.on('data', (d) => { buf += d; if (/\r?\n/.test(buf)) finish(/^\* (OK|PREAUTH)/i.test(buf)
      ? { ok: true, why: host + ':' + port }
      : { ok: false, why: host + ' greeted with ' + JSON.stringify(buf.slice(0, 60)) }); });
    /* A host that does not exist (ENOTFOUND) or refuses is broken for
       everybody. One that times out may only be refusing this runner's
       country - NetEase and some carriers filter by region - so it is
       reported as SLOW and does not fail the run: a check that is red every
       day for a reason nobody can act on teaches people to ignore it. */
    s.on('timeout', () => finish({ ok: false, slow: true, why: host + ':' + port + ' timed out' }));
    s.on('error', (e) => finish({ ok: false, slow: e.code === 'ETIMEDOUT', why: host + ':' + port + ' ' + (e.code || e.message) }));
  });
}

const jobs = [];
if (!ONLY || ONLY === 'remote') for (const [k, a] of Object.entries(table('REMOTE_APPS'))) jobs.push(['remote', k, a.name, () => remoteApp(k, a)]);
if (!ONLY || ONLY === 'oauth') for (const [k, p] of Object.entries(table('CONN_PROVIDERS'))) jobs.push(['oauth', k, p.name || k, () => oauthProvider(k, p)]);
if (!ONLY || ONLY === 'mail') {
  const port = constant('MAIL_IMAP_PORT') || 993;
  const seen = new Set();
  for (const [k, m] of Object.entries(table('MAIL_PROVIDERS'))) {
    if (!m.imap || seen.has(m.imap + ':' + (m.imapPort || port))) continue;
    seen.add(m.imap + ':' + (m.imapPort || port));
    jobs.push(['mail', k, m.name, () => imapGreeting(m.imap, m.imapPort || port)]);
  }
}

/* Eight at a time: fast, and gentle on any one provider. */
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < jobs.length) {
    const [kind, id, name, fn] = jobs[next++];
    const r = await twice(fn);
    results.push({ kind, id, name, ...r });
  }
}));
results.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
const bad = results.filter(r => !r.ok && !r.slow);
const slow = results.filter(r => !r.ok && r.slow);
if (JSON_OUT) console.log(JSON.stringify({ checked: results.length, failing: bad, slow }, null, 2));
else {
  for (const r of results) console.log((r.ok ? '  ok   ' : r.slow ? '  SLOW ' : '  FAIL ') + r.kind.padEnd(7) + r.name.padEnd(34).slice(0, 34) + ' ' + r.why);
  console.log('\n' + (results.length - bad.length - slow.length) + ' of ' + results.length + ' connectors answered.');
  if (slow.length) console.log('Timed out from here (may be region filtering, not failing the run): ' + slow.map(r => r.kind + ':' + r.id).join(', '));
  if (bad.length) console.log('Not answering: ' + bad.map(r => r.kind + ':' + r.id).join(', '));
}
process.exit(bad.length ? 1 : 0);
