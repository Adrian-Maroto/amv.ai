/* READINESS THAT HAS BEEN PROVED, NOT ASSUMED (Nov 3 audit REL-003, REL-019).

   /v1/health/ready asks the two stores every request needs, and reports every
   other capability as "configured": a key is present, a binding is declared.
   A key that was rotated at the provider, an R2 bucket deleted, a Postgres
   password changed, a Stripe account restricted - all of those read as "on"
   right up to the moment a customer finds out.

   So once an hour each configured capability does one real, harmless thing,
   with the same credentials and bindings real requests use:

     model      asks the cheapest engine for one token (a fraction of a cent)
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
   exercised too (below), each with the smallest real thing it does. */
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
  /* A REAL ANSWER, NOT A LIST (Nov 7 audit READY-022). Listing models
     passes for a key whose account has run out of credit, or a model the
     account cannot use - the two ways chat actually stops. So the cheapest
     engine is asked for one token, streamed as every chat is, and the
     stream has to start. About ten tokens an hour; still skipped while
     paused or past the day's ceiling (_synthModelHeld). */
  { id: 'model', on: (env) => _has(env, 'AMV_MODEL_KEY'),
    run: async (env) => {
      const r = await fetchDeadline(_modelBase(env) + '/v1/messages', { method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, _modelHeaders(env)),
        body: JSON.stringify({ model: ENGINES['amv-pulse'].model, max_tokens: 1, stream: true, messages: [{ role: 'user', content: 'Reply with OK.' }] }) }, SYNTH_STEP_MS);
      if (!r.ok) { try { await r.text(); } catch (e) { /* the status is the answer */ } throw new Error('the provider answered ' + r.status); }
      const text = await r.text();
      if (!/message_start/.test(text)) throw new Error('the provider answered, but no reply started');
    } },
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
  /* A SEND-ONLY KEY IS A WORKING KEY. The recommended Resend key may only
     send, and is refused the domain list with 401 `restricted_api_key` -
     which this read as broken, so production's healthy email was reported
     BROKEN every hour from the first run. That answer is the provider saying
     it knows the key; a key it does not know is 403 `invalid_api_key`, and
     that, or anything else, still fails. */
  { id: 'email', on: (env) => _has(env, 'EMAIL_API_KEY'),
    run: async (env) => {
      const r = await fetchDeadline('https://api.resend.com/domains', { method: 'GET', headers: { Authorization: 'Bearer ' + env.EMAIL_API_KEY } }, SYNTH_STEP_MS);
      let name = '';
      try { const d = await r.json(); name = String((d && d.name) || ''); } catch (e) { name = ''; /* the status alone is the answer */ }
      if (r.ok) return;
      if (r.status === 401 && name === 'restricted_api_key') return;
      throw new Error('the provider answered ' + r.status + (name ? ' (' + name.slice(0, 40) + ')' : ''));
    } },
  { id: 'payments', on: (env) => _has(env, 'STRIPE_SECRET_KEY'),
    run: (env) => _synthHttp('https://api.stripe.com/v1/balance', { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY }) },
];
/* THE QUEUE, ROUND TRIP (Nov 7 audit READY-021). Each run sends a probe
   and reads what the consumer recorded for the one before: the last probe
   must have arrived, and within the hour. Sending alone proved only that the
   queue accepts messages, not that anything ever takes them off it. */
const SYNTH_QUEUE_KEY = 'synth:queue';
SYNTH_PROBES.push({ id: 'job_queue', on: (env) => _jobQueueOn(env),
  run: async (env) => {
    let last = null;
    try { last = JSON.parse((await env.AMV_KV.get(SYNTH_QUEUE_KEY)) || 'null'); } catch (e) { last = null; }
    let sentBefore = 0;
    try { sentBefore = +(await env.AMV_KV.get(SYNTH_QUEUE_KEY + ':sent')) || 0; } catch (e) { sentBefore = 0; }
    const at = Date.now();
    await env.AMV_JOBS.sendBatch([{ body: { kind: 'synth', at } }]);
    await env.AMV_KV.put(SYNTH_QUEUE_KEY + ':sent', String(at), { expirationTtl: 3 * 86400 });
    /* The first run has nothing to compare with: sending is all it can prove. */
    if (!sentBefore) return;
    if (!last || +last.sent < sentBefore) throw new Error('the probe sent at the last check was never delivered');
    if (+last.got - +last.sent > 3600 * 1000) throw new Error('the last probe took ' + Math.round((+last.got - +last.sent) / 60000) + ' minutes to arrive');
  } });
/* THE TWO THAT WERE NEVER PROVED (Nov 8 audit READY-021/026). Both now do
   one small real thing an hour: the meaning index embeds two short phrases
   and they must come back as two vectors that agree; the hosted browser
   opens, renders one line and reads it back. Each costs a fraction of a
   cent an hour, and like the model they are held while the day's ceiling
   is reached. */
SYNTH_PROBES.push({ id: 'meaning', costs: true, on: (env) => _meaningOn(env),
  run: async (env) => {
    const out = await env.AI.run(MEANING_MODEL, { text: ['the cat sat on the mat', 'a cat is sitting on a mat'] });
    const v = out && Array.isArray(out.data) ? out.data : null;
    if (!v || v.length !== 2 || !v[0] || !v[0].length || v[0].length !== v[1].length) throw new Error('the model answered, but not with two matching vectors');
    if (!(_cosine(v[0], v[1]) > 0.5)) throw new Error('two sentences that mean the same came back unrelated');
  } });
SYNTH_PROBES.push({ id: 'browser', costs: true, on: (env) => !!env.BROWSER,
  run: async (env) => {
    const b = await _webLaunch(env, {});
    try {
      const page = await b.newPage();
      await page.setContent('<p id="p">amv-probe</p>');
      const got = await page.evaluate(() => document.getElementById('p').textContent);
      if (got !== 'amv-probe') throw new Error('the page opened, but did not read back what it was given');
    } finally { try { await b.close(); } catch (e) { /* the session ends with its own timeout */ } }
  } });
const SYNTH_NOT_EXERCISED = [];

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
  const modelHeld = SYNTH_PROBES.some(p => (p.id === 'model' || p.costs) && p.on(env)) ? await _synthModelHeld(env) : '';
  await Promise.all(SYNTH_PROBES.map(async (p) => {
    if (!p.on(env)) { results[p.id] = { ok: null, why: 'not configured' }; return; }
    if ((p.id === 'model' || p.costs) && modelHeld) { results[p.id] = { ok: null, why: modelHeld }; return; }
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
