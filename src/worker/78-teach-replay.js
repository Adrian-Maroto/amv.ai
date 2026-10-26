/* ══════════════════════════════════════════════════════════════════════════
   A TAUGHT TASK, REPLAYED STEP BY STEP AND CHECKED AS IT GOES.

   Teaching (72-web-takeover.js) records what was clicked and typed, and now
   how to find each thing again - its id, name, test id, label - and any
   checks the person added ("the page shows Order confirmed"). This runs
   those steps in AMV's browser exactly, without a model deciding what to do:

     each step finds its element by what was recorded, in a fixed order of
     trust (id, test id, name, label, placeholder, visible text), and a step
     whose element cannot be found STOPS the run there and says which step
     and why - it never clicks somewhere near instead;

     a check step passes only if the page shows the text within a few
     seconds; a failed check stops the run, so nothing after it happens on a
     page that is not the one the person expected;

     a step that was a secret (a password, a one-time code) types what the
     person supplies for this run, which is never stored, logged or returned -
     and a run without it stops at that step and asks;

     every page it reaches is held to the same address rules as any run, and
     the browser's time is charged as any run's is.

   The result is the list of steps with what happened to each, and the page
   as it was when the run ended - which is the evidence the person reads. */
const REPLAY_MAX_STEPS = 40;
const REPLAY_CHECK_MS = 4000;
const REPLAY_HOLD_MS = 3 * 60e3;
const REPLAY_FIND_FIELDS = ['id', 'testid', 'name', 'aria', 'ph', 'label', 'tag', 'type', 'role'];

/* One recorded locator, bounded and reduced to strings. */
function _replayFind(f){
  const out = {};
  if(!f || typeof f !== 'object') return out;
  for(const k of REPLAY_FIND_FIELDS){
    const v = f[k];
    if(typeof v === 'string' && v.trim()) out[k] = v.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return out;
}
/* The steps as sent, checked to the shapes teaching produces. Null when any
   step is not one of them - a replay is all of the task or none of it. */
function _replaySteps(raw){
  if(!Array.isArray(raw) || !raw.length || raw.length > REPLAY_MAX_STEPS) return null;
  const out = [];
  for(const s of raw){
    if(!s || typeof s !== 'object') return null;
    if(s.kind === 'click'){ const find = _replayFind(s.find || s); if(!Object.keys(find).length) return null; out.push({ kind: 'click', find, label: String(s.label || '').slice(0, 80) }); continue; }
    if(s.kind === 'type'){
      const find = _replayFind(s.find || s);
      if(s.secret){ out.push({ kind: 'type', secret: true, find, label: String(s.label || '').slice(0, 80) }); continue; }
      if(typeof s.text !== 'string' || !s.text || s.text.length > WEB_TAKE_TYPE_MAX) return null;
      out.push({ kind: 'type', text: s.text, find, label: String(s.label || '').slice(0, 80) }); continue;
    }
    if(s.kind === 'key'){ if(!WEB_TAKE_KEYS.includes(s.key)) return null; out.push({ kind: 'key', key: s.key }); continue; }
    if(s.kind === 'check'){ const t = String(s.text || '').replace(/\s+/g, ' ').trim(); if(!t || t.length > 200) return null; out.push({ kind: 'check', text: t }); continue; }
    return null;
  }
  return out;
}
/* Where the recorded element is now, as the middle of its box - a string,
   because page.evaluate runs it in the page. The values are JSON, never
   spliced in as code. Null when nothing matches; never a guess. */
function _replayLocate(find){
  return '(() => { const f = ' + JSON.stringify(find) + ';'
    + ' const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim().toLowerCase();'
    + ' const seen = (el) => { if(!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };'
    + ' const esc = (v) => (window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/["\\\\]/g, "\\\\$&");'
    + ' const by = [];'
    + ' if(f.id) by.push(() => document.getElementById(f.id));'
    + ' if(f.testid) by.push(() => document.querySelector("[data-testid=\\"" + esc(f.testid) + "\\"]"));'
    + ' if(f.name) by.push(() => [...document.getElementsByName(f.name)].find(seen));'
    + ' if(f.aria) by.push(() => [...document.querySelectorAll("[aria-label]")].find(e => norm(e.getAttribute("aria-label")) === norm(f.aria) && seen(e)));'
    + ' if(f.ph) by.push(() => [...document.querySelectorAll("[placeholder]")].find(e => norm(e.getAttribute("placeholder")) === norm(f.ph) && seen(e)));'
    + ' if(f.label) by.push(() => [...document.querySelectorAll("a,button,input,select,textarea,label,[role]")].find(e => seen(e) && (norm(e.innerText) === norm(f.label) || norm(e.getAttribute("aria-label")) === norm(f.label) || norm(e.getAttribute("placeholder")) === norm(f.label) || norm(e.value) === norm(f.label) || (e.labels && e.labels[0] && norm(e.labels[0].innerText) === norm(f.label)))));'
    + ' for(const get of by){ let el = null; try{ el = get(); }catch(e){} if(el && seen(el)){ el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; } }'
    + ' return null; })()';
}
function _replayShows(text){
  return '(() => String(document.body ? document.body.innerText : "").replace(/\\s+/g, " ").toLowerCase().includes(' + JSON.stringify(String(text).toLowerCase()) + '))()';
}

async function browserReplay(request, env, ctx){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'Sign in to run a taught task.' }, 401);
  const limited = await guardAction(env, 'webreplay:' + user.email, 6, 120, 'taught task runs');
  if(limited) return limited;
  const body = await request.json().catch(() => ({}));
  const gate = _webHostAllowed(body.url);
  if(!gate.ok) return json({ error: gate.why, code:'blocked_url' }, 400);
  const steps = _replaySteps(body.steps);
  if(!steps) return json({ error:'Those steps are not a task AMV was taught. Teach it again.', code:'bad_steps' }, 400);
  /* What the person typed for this run's secret steps, by step number. Held
     for this request only. */
  const secrets = (body.secrets && typeof body.secrets === 'object') ? body.secrets : {};
  if(!env.BROWSER) return json({ error:'AMV’s browser is not enabled on this deployment, so taught tasks cannot run here.', code:'needs_service' }, 503);
  const holdUSD = (REPLAY_HOLD_MS / 3600000) * WEB_BROWSER_USD_PER_HOUR;
  const book = {};
  const refused = await _spendGate(env, user, 'webreplay', holdUSD, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
  if(refused) return refused;
  const subject = user.billingSubject || user.email;
  const started = Date.now();
  let browser = null;
  const results = [];
  let failedAt = -1, why = '', need = '';
  try{
    try{ browser = await _webLaunch(env, {}); }
    catch(e){ await _recordSpend(env, subject, 0, 'webreplay', book.period, book).catch(() => {}); return json({ error:'AMV’s browser could not be started. Try again in a moment.', code:'needs_service' }, 503); }
    const page = await browser.newPage();
    await page.setViewport({ width:1280, height:900 });
    const denied = [];
    const isolated = await _webIsolate(page, (url, w, kind) => { if(denied.length < 5) denied.push({ url:String(url).slice(0, 200), why: w, kind }); });
    if(!isolated) throw Object.assign(new Error('isolation'), { amv: 'AMV’s browser cannot be used safely on this deployment right now.' });
    const jarIn = _webJarIn(body.cookies);
    if(jarIn.length && typeof page.setCookie === 'function') await page.setCookie(...jarIn).catch(() => {});
    await page.goto(gate.url, { waitUntil:'domcontentloaded', timeout:20000 }).catch(() => {});
    for(let i = 0; i < steps.length; i++){
      const s = steps[i];
      const stop = (w, n) => { failedAt = i; why = w; if(n) need = n; results.push({ i, kind: s.kind, ok: false, why: w }); };
      const here = await page.url().catch(() => '');
      const g = here ? _webHostAllowed(here) : { ok: false, why: 'The page could not be read.' };
      if(!g.ok){ stop('The page went somewhere AMV is not allowed to go. ' + (g.why || '')); break; }
      if(s.kind === 'check'){
        let shown = false;
        const until = Date.now() + REPLAY_CHECK_MS;
        while(!shown && Date.now() < until){
          try{ shown = !!(await page.evaluate(_replayShows(s.text))); }catch(e){ shown = false; }
          if(!shown) await new Promise(r => setTimeout(r, 400));
        }
        if(!shown){ stop('The page does not show “' + s.text + '”.'); break; }
        results.push({ i, kind: 'check', ok: true });
        continue;
      }
      if(s.kind === 'key'){
        await page.keyboard.press(s.key === 'Space' ? ' ' : s.key).catch(() => {});
        await new Promise(r => setTimeout(r, WEB_SETTLE_MS));
        results.push({ i, kind: 'key', ok: true });
        continue;
      }
      let at = null;
      try{ at = await page.evaluate(_replayLocate(s.find)); }catch(e){ at = null; }
      if(!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)){ stop('Could not find ' + (s.label ? '“' + s.label + '”' : 'what this step uses') + ' on the page.'); break; }
      if(s.kind === 'type' && s.secret){
        const v = secrets[String(i)];
        if(typeof v !== 'string' || !v || v.length > WEB_TAKE_TYPE_MAX){ stop('This step types a secret, and none was given for this run.', 'secret'); break; }
        await page.mouse.click(at.x, at.y).catch(() => {});
        await page.keyboard.type(v).catch(() => {});
      } else if(s.kind === 'type'){
        await page.mouse.click(at.x, at.y).catch(() => {});
        await page.keyboard.type(s.text).catch(() => {});
      } else {
        await page.mouse.click(at.x, at.y).catch(() => {});
      }
      await new Promise(r => setTimeout(r, WEB_SETTLE_MS));
      results.push({ i, kind: s.kind, ok: true });
    }
    let shot = '', url = '';
    try{ url = await page.url(); }catch(e){}
    try{ shot = await page.screenshot({ type:'jpeg', quality:45, encoding:'base64' }); }catch(e){}
    await browser.close().catch(() => {}); browser = null;
    /* What it actually held the browser for, not the reservation. */
    const used = Math.min(holdUSD, ((Date.now() - started) / 3600000) * WEB_BROWSER_USD_PER_HOUR);
    await _recordSpend(env, subject, used, 'webreplay', book.period, book);
    audit(env, 'web_replay', { by: user.email, site: _webTeachWhere(url || gate.url).split('/')[0], steps: steps.length, ok: failedAt < 0, at: failedAt });
    return json({ ok: failedAt < 0, ran: results.filter(r => r.ok).length, of: steps.length, results,
                  ...(failedAt >= 0 ? { failedAt, why, ...(need ? { need } : {}) } : {}),
                  url: String(url).slice(0, 500), shot: shot.length <= WEB_SHOT_MAX ? shot : '' });
  }catch(e){
    if(browser) await browser.close().catch(() => {});
    await _recordSpend(env, subject, 0, 'webreplay', book.period, book).catch(() => {});
    if(e && e.amv) return json({ error: e.amv, code:'needs_service' }, 503);
    if(ctx && ctx.waitUntil) ctx.waitUntil(_workerError(env, 'browserReplay', e));
    return json({ error:'The taught task could not be run. Try again.', code:'replay_failed' }, 502);
  }
}
