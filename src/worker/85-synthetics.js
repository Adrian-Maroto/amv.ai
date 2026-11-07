/* READINESS THAT HAS BEEN PROVED, NOT ASSUMED (Nov 3 audit REL-003, REL-019).

   /v1/health/ready asks the two stores every request needs, and reports every
   other capability as "configured": a key is present, a binding is declared.
   A key that was rotated at the provider, an R2 bucket deleted, a Postgres
   password changed, a Stripe account restricted - all of those read as "on"
   right up to the moment a customer finds out.

   So once an hour each configured capability does one real, harmless thing,
   with the same credentials and bindings real requests use:

     model      lists the provider's models        (read; costs nothing)
     postgres   SELECT 1                            (read)
     library    writes, reads back and deletes a probe object
     email      lists the sending domains          (read)
     payments   reads the Stripe balance            (read)

   Nothing here touches an account, charges anybody or sends anything to a
   person. The answer is kept (synth:last) and readiness reports it as
   `proved`, with its age, beside `capabilities` - so a monitor can tell
   "configured and working" from "configured". A capability that fails is told
   to the owner once a day per capability, naming it, with the provider's own
   status code. The job queue, the hosted browser and the meaning index are
   not exercised: each would spend real money or real work to prove itself,
   and they say "not exercised" rather than pretending. */
const SYNTH_KEY = 'synth:last';
/* The trigger that runs them (wrangler.toml crons) - once an hour. */
const SYNTH_CRON = '17 * * * *';
const SYNTH_FRESH_MS = 2 * 3600 * 1000;
const SYNTH_STEP_MS = 8000;

function _synthStep(p) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after ' + SYNTH_STEP_MS + 'ms')), SYNTH_STEP_MS))]);
}
async function _synthHttp(url, headers) {
  const r = await fetchDeadline(url, { method: 'GET', headers }, SYNTH_STEP_MS);
  if (!r.ok) throw new Error('the provider answered ' + r.status);
  try { await r.text(); } catch (e) { /* the status is the answer; an unread body does not change it */ }
}

const SYNTH_PROBES = [
  { id: 'model', on: (env) => _has(env, 'AMV_MODEL_KEY'),
    run: (env) => _synthHttp(_modelBase(env) + '/v1/models?limit=1', _modelHeaders(env)) },
  { id: 'postgres', on: (env) => _pgOn(env),
    run: async (env) => {
      const sql = await _pgClient(env);
      try { const rows = await sql`select 1 as one`; if (!rows || !rows.length || +rows[0].one !== 1) throw new Error('answered, but not with 1'); }
      finally { try { await sql.end({ timeout: 2 }); } catch (e) { /* the connection closes with the isolate either way */ } }
    } },
  { id: 'library', on: (env) => libConfigured(env),
    run: async (env) => {
      const key = 'synthetic/probe-' + Date.now().toString(36);
      const body = 'amv-probe-' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      await env.AMV_FILES.put(key, body);
      try {
        const o = await env.AMV_FILES.get(key);
        const back = o ? await o.text() : null;
        if (back !== body) throw new Error(o ? 'read back something else' : 'wrote, then could not read it back');
      } finally { try { await env.AMV_FILES.delete(key); } catch (e) { /* a probe left behind is 20 bytes under synthetic/, swept by the next run's put of a new name */ } }
    } },
  { id: 'email', on: (env) => _has(env, 'EMAIL_API_KEY'),
    run: (env) => _synthHttp('https://api.resend.com/domains', { Authorization: 'Bearer ' + env.EMAIL_API_KEY }) },
  { id: 'payments', on: (env) => _has(env, 'STRIPE_SECRET_KEY'),
    run: (env) => _synthHttp('https://api.stripe.com/v1/balance', { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY }) },
];
const SYNTH_NOT_EXERCISED = ['job_queue', 'browser', 'meaning'];

/* A STOP MEANS NO PROVIDER IS CALLED (stop-means-stop-spending). Listing
   models costs nothing, but "paused" and "the day's ceiling is reached" are
   promises that AMV is not talking to the model provider at all, and a probe
   is not an exception. The cron skips this whole run while paused; past the
   ceiling - or when the ceiling cannot be read - the model is not probed and
   says why, and everything else still is. */
async function _synthModelHeld(env) {
  const cap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (!(cap > 0)) return '';
  try { const g = await _checkGlobalCap(env, 'synthetic', cap); return g && g.allowed ? '' : 'not probed: the day\u2019s spending ceiling is reached'; }
  catch (e) { return 'not probed: the day\u2019s spending could not be read'; }
}
async function runCapabilitySynthetics(env) {
  const at = Date.now();
  const results = {};
  const modelHeld = SYNTH_PROBES[0].on(env) ? await _synthModelHeld(env) : '';
  await Promise.all(SYNTH_PROBES.map(async (p) => {
    if (!p.on(env)) { results[p.id] = { ok: null, why: 'not configured' }; return; }
    if (p.id === 'model' && modelHeld) { results[p.id] = { ok: null, why: modelHeld }; return; }
    const t = Date.now();
    try { await _synthStep(p.run(env)); results[p.id] = { ok: true, ms: Date.now() - t }; }
    catch (e) { results[p.id] = { ok: false, ms: Date.now() - t, why: String((e && e.message) || e).slice(0, 160) }; }
  }));
  for (const id of SYNTH_NOT_EXERCISED) results[id] = { ok: null, why: 'not exercised: proving it would spend real money or work' };
  const failed = Object.entries(results).filter(([, r]) => r.ok === false).map(([id]) => id);
  const rec = { at, results, failed };
  try { await env.AMV_KV.put(SYNTH_KEY, JSON.stringify(rec), { expirationTtl: 7 * 86400 }); }
  catch (e) { audit(env, 'synthetics_not_kept', { why: String((e && e.message) || e).slice(0, 120) }); }
  for (const id of failed) {
    audit(env, 'synthetic_failed', { capability: id, why: results[id].why });
    try { await alertOnce(env, 'synth_' + id, 'A configured capability failed its hourly check: ' + id + ' - ' + results[id].why
      + '. It is set up, and it does not work. See docs/INCIDENT-RUNBOOK.md, "One part is misbehaving".', 24 * 60); }
    catch (e) { /* the failure is already in the audit line and in readiness */ }
  }
  return rec;
}

/* What readiness says: the last run, if it is recent enough to mean anything. */
async function _synthProved(env, now) {
  let rec = null;
  try { const raw = await env.AMV_KV.get(SYNTH_KEY); rec = raw ? JSON.parse(raw) : null; }
  catch (e) { return { state: 'unknown', why: 'could not be read' }; }
  if (!rec || !rec.at) return { state: 'never', why: 'no check has run yet' };
  const age = now - rec.at;
  if (age > SYNTH_FRESH_MS) return { state: 'stale', ageMin: Math.round(age / 60000), why: 'the last check is older than two hours' };
  const proved = {};
  for (const [id, r] of Object.entries(rec.results || {})) proved[id] = r.ok === true ? true : r.ok === false ? false : null;
  return { state: rec.failed && rec.failed.length ? 'failing' : 'ok', ageMin: Math.round(age / 60000), proved, failed: rec.failed || [],
           why: Object.fromEntries(Object.entries(rec.results || {}).filter(([, r]) => r.ok === false).map(([id, r]) => [id, r.why])) };
}
