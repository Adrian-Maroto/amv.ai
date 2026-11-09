/* THE STAGING DRILL - every flow that matters, against real services.

   Every suite in this repository runs the Worker against local stand-ins
   that keep the providers' rules. That proves the code; it cannot prove the
   deployment - the real KV, the real Durable Object, R2, the search index,
   the model, Stripe in test mode, the queue. This does, from the outside,
   through the same HTTP routes the app uses:

     health and readiness · an invite, two new accounts, sign-in · sync,
     including two devices writing at once · files: kept, read back, the
     same file again, two at once, a twelve-passage file, search inside,
     another account cannot see them, delete · one short answer from the
     model, streamed · a Stripe checkout is created in TEST mode (never paid)
     · both accounts erased, and sign-in refused afterwards.

   It makes two throwaway accounts and erases them at the end, whatever
   happened in between. It spends a fraction of a cent of model and index
   use. It never pays for anything, and it refuses to run against
   production: the host must not be amv.homes (or any host in
   AMV_PRODUCTION_HOSTS), and a Stripe checkout that comes back LIVE stops it.

   Usage:
     AMV_STAGING_URL=https://amv-staging.<you>.workers.dev \
     AMV_STAGING_ADMIN_TOKEN=<the staging ADMIN_TOKEN> \
     node scripts/staging-drill.mjs [--json] [--out=drill.json]

   Optional: AMV_STAGING_ORIGIN (the app origin the Worker allows; defaults
   to the Worker's APP_URL as it reports it), AMV_STAGING_EMAIL_DOMAIN (the
   domain the throwaway accounts use; default example.com). A staging
   deployment with a captcha needs Turnstile's always-pass test secret, or
   no TURNSTILE_SECRET at all - the drill says so if sign-up asks for one.

   Exit status: 0 when nothing failed (skipped steps are listed, with why),
   1 otherwise. */

const PROD_HOSTS = ['amv.homes', 'www.amv.homes', 'api.amv.homes'];

export async function runDrill(opt = {}) {
  const base = String(opt.base || '').replace(/\/$/, '');
  const admin = String(opt.adminToken || '');
  const doFetch = opt.fetch || globalThis.fetch;
  const domain = opt.emailDomain || 'example.com';
  const log = opt.log || (() => {});
  const results = [];
  const started = Date.now();

  let host = '';
  try { host = new URL(base).hostname.toLowerCase(); } catch (e) { host = ''; }
  const prod = PROD_HOSTS.concat(String(opt.productionHosts || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  if (!host) return { ok: false, refused: 'Set AMV_STAGING_URL to the staging Worker address.', results };
  if (prod.some(p => host === p || host.endsWith('.' + p))) return { ok: false, refused: host + ' is production. The drill runs only against staging.', results };
  if (!admin) return { ok: false, refused: 'Set AMV_STAGING_ADMIN_TOKEN to the staging ADMIN_TOKEN.', results };

  const origin = opt.origin || '';
  const call = async (method, path, body, token, extra) => {
    const t0 = Date.now();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, origin ? { Origin: origin } : {},
      token ? { Authorization: 'Bearer ' + token } : {}, extra || {});
    const r = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let d = null; try { d = JSON.parse(text); } catch (e) { d = null; }
    return { status: r.status, d, text, ms: Date.now() - t0, headers: r.headers };
  };
  const adminCall = (method, path, body) => call(method, path, body, null, { 'X-Admin-Token': admin });
  /* What a refusal said, in its own words: the code and the start of the
     message the person would see. Never a token or a key. */
  const why = (r) => r.status + (r.d && (r.d.code || r.d.error) ? ' ' + [r.d.code, r.d.error].filter(Boolean).join(': ').slice(0, 160) : '');

  let stopped = null;
  const step = async (id, name, fn) => {
    if (stopped) { results.push({ id, name, status: 'skipped', note: 'not run: ' + stopped }); return null; }
    const t0 = Date.now();
    try {
      const out = (await fn()) || {};
      const status = out.skip ? 'skipped' : (out.ok ? 'passed' : 'failed');
      results.push({ id, name, status, note: out.note || out.skip || '', ms: Date.now() - t0 });
      log(status, id, name, out.note || out.skip || '');
      if (out.stop) stopped = out.stop;
      return out;
    } catch (e) {
      results.push({ id, name, status: 'failed', note: String((e && e.message) || e).slice(0, 300), ms: Date.now() - t0 });
      log('failed', id, name, String((e && e.message) || e));
      return null;
    }
  };

  const run = Date.now().toString(36);
  const PW = 'Drill-' + run + '-a-long-staging-passphrase!';
  const people = { a: { email: 'amv-drill+' + run + '-a@' + domain }, b: { email: 'amv-drill+' + run + '-b@' + domain } };
  let invite = '', libraryOn = false, searchOn = false;

  try {
    await step('health', 'The Worker answers', async () => {
      const r = await call('GET', '/v1/health');
      return { ok: r.status === 200 && r.d && r.d.ok === true, note: r.status + ' in ' + r.ms + 'ms', stop: r.status === 200 ? null : 'the Worker did not answer' };
    });
    await step('ready', 'Its stores answer (readiness)', async () => {
      const r = await call('GET', '/v1/health/ready');
      const bad = r.d && typeof r.d === 'object' ? Object.entries(r.d).filter(([, v]) => v === false).map(([k]) => k) : [];
      return { ok: r.status === 200 && !bad.length, note: bad.length ? 'not ready: ' + bad.join(', ') : 'ready (' + r.ms + 'ms)' };
    });
    await step('config', 'What this deployment has switched on', async () => {
      const r = await adminCall('GET', '/admin/readiness');
      if (r.status === 401 || r.status === 403) {
        /* Which side is wrong, without ever showing the token. */
        const notSet = r.d && r.d.code === 'admin_not_configured';
        const odd = admin !== admin.trim() ? ' - the copy here has a space or line break at its start or end' : (/\s/.test(admin) ? ' - the copy here has a space inside it' : '');
        return { ok: false, stop: 'the admin token is wrong',
          note: notSet ? 'this Worker has NO ADMIN_TOKEN set - add it on this Worker (check its name) and deploy'
                       : 'the admin token was refused: the copy here (' + admin.length + ' characters' + odd + ') does not match this Worker\u2019s ADMIN_TOKEN' };
      }
      const rows = (r.d && Array.isArray(r.d.items)) ? r.d.items : [];
      const blockingOff = rows.filter(x => x && x.blocking && !x.on).map(x => x.name);
      return { ok: r.status === 200 && !blockingOff.length, note: blockingOff.length ? 'blocking and off: ' + blockingOff.join(', ') : rows.filter(x => x && x.on).length + ' of ' + rows.length + ' capabilities on' };
    });
    await step('invite', 'An invite for the drill’s two accounts', async () => {
      const r = await adminCall('POST', '/admin/invites', { count: 1, uses: 2, days: 1 });
      invite = (r.d && r.d.codes && r.d.codes[0]) || '';
      return { ok: r.status === 200 && !!invite, note: invite ? 'made, two uses, one day' : 'status ' + r.status };
    });
    for (const k of ['a', 'b']) {
      await step('signup-' + k, 'A new account (' + k.toUpperCase() + ') signs up', async () => {
        const r = await call('POST', '/auth/signup', { email: people[k].email, name: 'Drill ' + k.toUpperCase(), password: PW, ref: invite || undefined });
        if (r.d && r.d.code === 'captcha_required') return { ok: false, note: 'sign-up asked for a captcha: give staging Turnstile’s always-pass test secret, or none', stop: 'no account could be made' };
        people[k].token = r.d && r.d.token;
        return { ok: r.status === 200 && !!people[k].token, note: r.status === 200 ? 'in ' + r.ms + 'ms' : 'status ' + r.status + ' ' + ((r.d && (r.d.code || r.d.error)) || ''), stop: people[k].token ? null : 'no account could be made' };
      });
    }
    await step('login', 'Signing in again gives a working session', async () => {
      const r = await call('POST', '/auth/login', { email: people.a.email, password: PW });
      if (r.d && r.d.token) people.a.token = r.d.token;
      return { ok: r.status === 200 && !!(r.d && r.d.token), note: r.d && r.d.mfa ? 'asked for a second step (unexpected for a new account)' : 'in ' + r.ms + 'ms' };
    });

    await step('sync', 'What one device saves, another reads back', async () => {
      const p = await call('POST', '/sync/push', { data: { settings: { drill: run } }, baseRev: 0 }, people.a.token);
      const g = await call('POST', '/sync/pull', {}, people.a.token);
      const got = g.d && g.d.data && g.d.data.settings && g.d.data.settings.drill;
      return { ok: p.status === 200 && g.status === 200 && got === run, note: got === run ? 'read back' : 'push ' + p.status + ', pull ' + g.status };
    });
    await step('sync-race', 'Two devices saving at once both keep their work', async () => {
      const g = await call('POST', '/sync/pull', {}, people.a.token);
      const rev = +((g.d && (g.d.rev || (g.d.data && g.d.data._rev))) || 0);
      const [x, y] = await Promise.all([
        call('POST', '/sync/push', { data: { prompts: [{ id: 'drill-x', text: 'from device X' }] }, baseRev: rev }, people.a.token),
        call('POST', '/sync/push', { data: { skills: [{ id: 'drill-y', name: 'from device Y' }] }, baseRev: rev }, people.a.token)]);
      const after = await call('POST', '/sync/pull', {}, people.a.token);
      const d = (after.d && after.d.data) || {};
      const both = JSON.stringify(d.prompts || []).includes('drill-x') && JSON.stringify(d.skills || []).includes('drill-y');
      return { ok: x.status < 500 && y.status < 500 && both, note: both ? 'both kept' : 'X ' + x.status + ', Y ' + y.status + '; kept: ' + ['prompts', 'skills'].filter(k => JSON.stringify(d[k] || []).includes('drill-')).join(', ') };
    });

    await step('library', 'Files in the account are switched on', async () => {
      const r = await call('GET', '/v1/library', undefined, people.a.token);
      libraryOn = r.status === 200 && r.d && r.d.configured === true;
      searchOn = !!(r.d && r.d.searchInside);
      return libraryOn ? { ok: true, note: searchOn ? 'with search inside files' : 'search inside files is off' } : { skip: 'not configured on this deployment (R2)' };
    });
    const files = {};
    const put = (tok, name, body, sig) => call('POST', '/v1/library/put', { kind: 'text', name, body, sig: sig || ('drill-' + name + '-' + body.length), size: body.length }, tok);
    await step('file-keep', 'A file is kept and read back exactly', async () => {
      if (!libraryOn) return { skip: 'files are off' };
      const body = 'The landlord says the lease ends in March. Rent goes up by four percent. (' + run + ')';
      const r = await put(people.a.token, 'lease.txt', body);
      files.lease = r.d && r.d.file && r.d.file.id;
      const g = files.lease ? await call('GET', '/v1/library/get?id=' + encodeURIComponent(files.lease), undefined, people.a.token) : { status: 0 };
      return { ok: r.status === 200 && g.status === 200 && g.d && g.d.body === body, note: 'kept in ' + r.ms + 'ms, read in ' + (g.ms || 0) + 'ms' };
    });
    await step('file-same', 'The same file again is the same file', async () => {
      if (!libraryOn || !files.lease) return { skip: 'no first file' };
      const body = 'The landlord says the lease ends in March. Rent goes up by four percent. (' + run + ')';
      const r = await put(people.a.token, 'lease.txt', body);
      return { ok: r.status === 200 && r.d && r.d.existed === true && r.d.file && r.d.file.id === files.lease, note: r.d && r.d.existed ? 'recognised' : 'kept twice' };
    });
    await step('file-race', 'Two uploads at once are both kept, neither left pending', async () => {
      if (!libraryOn) return { skip: 'files are off' };
      const [x, y] = await Promise.all([put(people.a.token, 'x.txt', 'drill file x ' + run), put(people.a.token, 'y.txt', 'drill file y ' + run)]);
      files.x = x.d && x.d.file && x.d.file.id; files.y = y.d && y.d.file && y.d.file.id;
      const l = await call('GET', '/v1/library', undefined, people.a.token);
      const ids = ((l.d && l.d.files) || []).map(f => f.id);
      return { ok: x.status === 200 && y.status === 200 && ids.includes(files.x) && ids.includes(files.y), note: 'x ' + x.status + ', y ' + y.status + ', listed ' + [files.x, files.y].filter(i => ids.includes(i)).length + ' of 2' };
    });
    await step('file-long', 'A twelve-passage file is kept (and indexed, when search is on)', async () => {
      if (!libraryOn) return { skip: 'files are off' };
      const body = Array.from({ length: 12 }, (_, i) => 'Passage ' + i + ': ' + 'quarterly tax receipt detail. '.repeat(45)).join('\n\n');
      const r = await put(people.a.token, 'long.txt', body);
      files.long = r.d && r.d.file && r.d.file.id;
      return { ok: r.status === 200 && !!files.long, note: 'status ' + r.status + ' in ' + r.ms + 'ms' };
    });
    await step('search', 'Search finds a file by what it says', async () => {
      if (!libraryOn || !searchOn) return { skip: 'search inside files is off' };
      const r = await call('POST', '/v1/library/search', { query: 'when does my tenancy finish' }, people.a.token);
      const hit = ((r.d && r.d.results) || []).some(x => x.id === files.lease);
      return { ok: r.status === 200 && hit, note: hit ? 'found in ' + r.ms + 'ms' : 'status ' + r.status + ', ' + ((r.d && r.d.results) || []).length + ' results' };
    });
    await step('isolation', 'Another account sees none of it', async () => {
      if (!libraryOn) return { skip: 'files are off' };
      const l = await call('GET', '/v1/library', undefined, people.b.token);
      const g = files.lease ? await call('GET', '/v1/library/get?id=' + encodeURIComponent(files.lease), undefined, people.b.token) : { status: 404 };
      const s = searchOn ? await call('POST', '/v1/library/search', { query: 'landlord lease rent' }, people.b.token) : { d: { results: [] } };
      const leaked = ((l.d && l.d.files) || []).length || g.status === 200 || ((s.d && s.d.results) || []).length;
      return { ok: l.status === 200 && !leaked, note: leaked ? 'ACCOUNT B SAW ACCOUNT A’S FILES' : 'list, read and search all empty for B' };
    });
    await step('file-delete', 'Deleted files are gone, from the list and from storage', async () => {
      if (!libraryOn) return { skip: 'files are off' };
      const ids = [files.lease, files.x, files.y, files.long].filter(Boolean);
      const r = await call('POST', '/v1/library/delete', { ids }, people.a.token);
      const l = await call('GET', '/v1/library', undefined, people.a.token);
      const left = ((l.d && l.d.files) || []).filter(f => ids.includes(f.id)).length;
      const g = files.lease ? await call('GET', '/v1/library/get?id=' + encodeURIComponent(files.lease), undefined, people.a.token) : { status: 404 };
      return { ok: r.status === 200 && !left && g.status === 404, note: 'delete ' + r.status + (r.d && r.d.error ? ' (' + r.d.error + ')' : '') + ', ' + left + ' still listed' };
    });

    await step('model', 'The model answers, streamed', async () => {
      const r = await call('POST', '/v1/messages', { messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 16, stream: true }, people.a.token);
      if (r.status === 503 && r.d && /not_configured|no_model|model/i.test(JSON.stringify(r.d))) return { skip: 'no model key on this deployment' };
      const streamed = /event-stream/.test(String(r.headers.get('content-type') || '')) && /content_block_delta|text_delta/.test(r.text);
      return { ok: r.status === 200 && streamed, note: r.status === 200 ? 'first answer in ' + r.ms + 'ms' : 'status ' + r.status + ' ' + ((r.d && (r.d.code || r.d.error)) || '') };
    });
    await step('consent', 'The terms are accepted, with a birth year (paying needs both)', async () => {
      const r = await call('POST', '/v1/consent', { birthYear: 1990, termsVersion: opt.termsVersion || 'staging-drill' }, people.a.token);
      return { ok: r.status === 200, note: why(r) };
    });
    await step('stripe', 'A checkout is created in Stripe TEST mode (nothing is paid)', async () => {
      const r = await call('POST', '/v1/stripe/checkout', { plan: 'pro', cycle: 'month' }, people.a.token);
      const url = String((r.d && (r.d.url || r.d.checkoutUrl)) || '');
      if (r.status >= 500 && /stripe|not configured|STRIPE/i.test(r.text) && !url) return { skip: 'Stripe is not configured here' };
      if (/cs_live_/.test(url)) return { ok: false, note: 'STRIPE IS LIVE ON THIS DEPLOYMENT - staging must use a test key', stop: 'Stripe is live' };
      return { ok: r.status === 200 && /cs_test_/.test(url), note: url ? (/cs_test_/.test(url) ? 'test checkout made' : 'a checkout that is not marked test: ' + url.slice(0, 60)) : why(r) };
    });
  } finally {
    /* Always: the two accounts go, and the invite. */
    stopped = null;
    for (const k of ['a', 'b']) {
      await step('erase-' + k, 'Account ' + k.toUpperCase() + ' is erased, and cannot sign in afterwards', async () => {
        if (!people[k].token) return { skip: 'it was never made' };
        const r = await call('POST', '/auth/delete', { password: PW }, people[k].token);
        const l = await call('POST', '/auth/login', { email: people[k].email, password: PW });
        const old = await call('POST', '/sync/pull', {}, people[k].token);
        return { ok: r.status === 200 && l.status >= 400 && l.status < 500 && old.status === 401, note: 'delete ' + why(r) + ', sign-in ' + l.status + ', old session ' + old.status };
      });
    }
    if (invite) await step('invite-revoke', 'The drill’s invite is revoked', async () => {
      const r = await adminCall('POST', '/admin/invites/revoke', { code: invite });
      return { ok: r.status === 200, note: 'status ' + r.status };
    });
  }
  const failed = results.filter(r => r.status === 'failed');
  return { ok: !failed.length, base: host, run, ms: Date.now() - started, passed: results.filter(r => r.status === 'passed').length,
           failed: failed.length, skipped: results.filter(r => r.status === 'skipped').length, results };
}

/* The command line. */
const isMain = (() => { try { return import.meta.url === new URL('file://' + process.argv[1]).href; } catch (e) { return false; } })();
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const outArg = args.find(a => a.startsWith('--out='));
  const mark = { passed: '\x1b[32m✓\x1b[0m', failed: '\x1b[31m✗\x1b[0m', skipped: '\x1b[2m-\x1b[0m' };
  const report = await runDrill({ base: process.env.AMV_STAGING_URL, adminToken: process.env.AMV_STAGING_ADMIN_TOKEN,
    origin: process.env.AMV_STAGING_ORIGIN, emailDomain: process.env.AMV_STAGING_EMAIL_DOMAIN, productionHosts: process.env.AMV_PRODUCTION_HOSTS,
    log: asJson ? undefined : (st, id, name, note) => console.log('  ' + mark[st] + ' ' + name + (note ? '  \x1b[2m' + note + '\x1b[0m' : '')) });
  if (outArg) { const { writeFileSync } = await import('fs'); writeFileSync(outArg.slice(6), JSON.stringify(report, null, 2)); }
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else if (report.refused) console.log('\x1b[31mRefused:\x1b[0m ' + report.refused);
  else console.log('\n' + (report.ok ? '\x1b[32mSTAGING PASSES\x1b[0m' : '\x1b[31mSTAGING FAILS\x1b[0m') + ' - ' + report.passed + ' passed, ' + report.failed + ' failed, ' + report.skipped + ' skipped, in ' + Math.round(report.ms / 1000) + 's');
  process.exit(report.ok ? 0 : 1);
}
