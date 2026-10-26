/* ── TAKING OVER AMV'S BROWSER ─────────────────────────────────────────────

   A run in AMV's hosted browser stops where only the person can go on: a
   captcha, or a sign-in AMV has nothing for. Before this it closed the
   browser and said so, and the person had nowhere to do the one thing asked
   of them. Now, in a run they are watching, the browser is HANDED OVER
   instead: kept open for WEB_HOLD_MS, and the panel becomes the controls -
   tap the picture to click there, type, press a key, scroll - then "carry
   on" starts the run again on the same browser, signed in.

   This is the owner's delegated decision #4 in docs/OWNER-DECISIONS.md: the
   person signs in themselves, live, instead of AMV keeping sign-ins on its
   servers. Nothing here stores one.

   WHAT HOLDS IT SAFE:
     - The handle is the browser session's id, the account and an expiry,
       sealed under CONNECT_KEY. Only the account it was made for can use it,
       and only until the browser is closed by its keep-alive anyway.
     - Every action reconnects, and the request isolation that stops a page
       reaching internal addresses is put back on BEFORE anything is done -
       it belongs to a connection, so a reconnect without it would be the
       pivot _webIsolate exists to prevent. Where the page lands after the
       action is gated too, and a page that went somewhere it must not ends
       the browser.
     - What the person types reaches the page and nothing else: it is not
       logged, not kept, not shown to the model, and the audit records only
       that an action of that kind happened.
     - Each action is one short request, rate-limited per account. The time
       the browser is held is charged once, to the run that handed it over. */
const WEB_HOLD_MS = 10 * 60e3;
const WEB_TAKE_TYPE_MAX = 500;
const WEB_TAKE_KEYS = ['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

async function _webTakeSeal(env, email, sessionId, url, teach){
  return connSeal(env, { t: 'webtake', e: String(email).toLowerCase(), s: String(sessionId), x: Date.now() + WEB_HOLD_MS, u: String(url || '').slice(0, 500), ...(teach ? { k: 'teach' } : {}) });
}
async function _webTakeOpen(env, handle, email){
  if(!connConfigured(env) || typeof handle !== 'string' || handle.length > 2000) return null;
  let h; try{ h = await connOpen(env, handle); }catch(e){ return null; }
  if(!h || h.t !== 'webtake' || h.e !== String(email).toLowerCase() || !h.s || !(h.x > Date.now())) return null;
  return h;
}
async function _webConnect(env, sessionId){
  if(env.BROWSER && typeof env.BROWSER.connect === 'function') return env.BROWSER.connect(sessionId);
  const mod = await import('@cloudflare/puppeteer'); const puppeteer = mod.default || mod;
  return puppeteer.connect(env.BROWSER, sessionId);
}
/* What the person asked for, in a known shape, or null. */
function _webTakeAct(raw){
  const a = raw && typeof raw === 'object' ? raw : {};
  const n = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
  if(a.kind === 'click'){ const x = n(a.x, 0, 1279), y = n(a.y, 0, 899); return x === null || y === null ? null : { kind: 'click', x, y }; }
  if(a.kind === 'type'){ const t = typeof a.text === 'string' ? a.text : ''; return t && t.length <= WEB_TAKE_TYPE_MAX ? { kind: 'type', text: t } : null; }
  if(a.kind === 'key') return WEB_TAKE_KEYS.includes(a.key) ? { kind: 'key', key: a.key } : null;
  if(a.kind === 'scroll'){ const dy = n(a.dy, -3000, 3000); return dy === null ? null : { kind: 'scroll', dy }; }
  if(a.kind === 'look' || a.kind === 'close') return { kind: a.kind };
  /* While teaching: "the page shows this now", checked here and kept as a
     step a replay must see again (78-teach-replay.js). */
  if(a.kind === 'check'){ const t = typeof a.text === 'string' ? a.text.replace(/\s+/g, ' ').trim() : ''; return t && t.length <= 200 ? { kind: 'check', text: t } : null; }
  return null;
}

async function browserTakeover(request, env, ctx){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const limited = await guardAction(env, 'webtake:' + user.email, 60, 600, 'actions in AMV’s browser');
  if(limited) return limited;
  const body = await request.json().catch(() => ({}));
  const h = await _webTakeOpen(env, body.handle, user.email);
  if(!h) return json({ error:'That browser has closed - it is kept for ten minutes. Start the task again.', code:'takeover_gone' }, 410);
  const act = _webTakeAct(body.act);
  if(!act) return json({ error:'That is not something AMV’s browser can do.', code:'bad_action' }, 400);
  if(!env.BROWSER) return json({ error:'Web automation is not enabled on this deployment.', code:'needs_service' }, 503);
  let browser;
  try{ browser = await _webConnect(env, h.s); }
  catch(e){ return json({ error:'That browser has closed - it is kept for ten minutes. Start the task again.', code:'takeover_gone' }, 410); }
  try{
    if(act.kind === 'close'){
      await browser.close().catch(() => {});
      audit(env, 'web_takeover', { by: user.email, kind: 'close' });
      return json({ ok:true, closed:true });
    }
    const pages = await browser.pages().catch(() => []);
    const page = pages[pages.length - 1] || await browser.newPage();
    /* BEFORE anything else on this connection - see the note at the top. */
    const denied = [];
    const isolated = await _webIsolate(page, (url, why, kind) => { if(denied.length < 5) denied.push({ url: String(url).slice(0, 200), why, kind }); });
    if(!isolated){
      await browser.close().catch(() => {});
      return json({ error:'AMV’s browser cannot be used safely on this deployment right now, so it was closed.', code:'needs_service' }, 503);
    }
    /* TEACHING (browserTeach below): what the person is about to act on, read
       off the page BEFORE the action - after a click the page may be another.
       The text typed into a password or one-time-code field is never part of
       it; anything else typed is, because "set the status to Closed" is the
       step. Bounded, and only for a browser opened to be taught. */
    let step = null;
    if(act.kind === 'check'){
      if(h.k !== 'teach'){ await browser.disconnect().catch(() => {}); return json({ error:'Checks are added while teaching AMV.', code:'bad_action' }, 400); }
      let shown = false;
      try{ shown = !!(await page.evaluate(_replayShows(act.text))); }catch(e){ shown = false; }
      let at = ''; try{ at = _webTeachWhere(await page.url()); }catch(e){}
      await browser.disconnect().catch(() => {});
      return json({ ok:true, check: { kind: 'check', text: act.text, shown, at } });
    }
    if(h.k === 'teach' && (act.kind === 'click' || act.kind === 'type')){
      let el = null;
      try{ el = await page.evaluate(_webTeachDescribe(act.kind === 'click' ? 'document.elementFromPoint(' + act.x + ',' + act.y + ')' : 'document.activeElement')); }catch(e){ el = null; }
      step = _webTeachStep(act, el);
    } else if(h.k === 'teach' && act.kind === 'key') step = { kind: 'key', key: act.key };
    if(act.kind === 'click') await page.mouse.click(act.x, act.y).catch(() => {});
    else if(act.kind === 'type') await page.keyboard.type(act.text).catch(() => {});
    else if(act.kind === 'key') await page.keyboard.press(act.key === 'Space' ? ' ' : act.key).catch(() => {});
    else if(act.kind === 'scroll') await page.evaluate('window.scrollBy(0, ' + act.dy + ')').catch(() => {});
    if(act.kind !== 'look') await new Promise(r => setTimeout(r, WEB_SETTLE_MS));
    let here = ''; try{ here = await page.url(); }catch(e){}
    const g = here ? _webHostAllowed(here) : { ok: true };
    if(!g.ok){
      await browser.close().catch(() => {});
      audit(env, 'web_agent_blocked', { by: user.email, reason: 'takeover', to: here.slice(0, 200) });
      return json({ ok:false, code:'blocked_url', error:'The page went somewhere AMV is not allowed to go, so the browser was closed. ' + g.why }, 400);
    }
    let shot = '';
    try{ shot = await page.screenshot({ type:'jpeg', quality:45, encoding:'base64' }); }catch(e){}
    await browser.disconnect().catch(() => {});
    /* The kind of action, never what was typed. */
    audit(env, 'web_takeover', { by: user.email, kind: act.kind });
    if(step) step.at = _webTeachWhere(here);
    return json({ ok:true, url: here.slice(0, 500), shot: shot.length <= WEB_SHOT_MAX ? shot : '', blockedRequests: denied.length, ...(step ? { step } : {}) });
  }catch(e){
    try{ await browser.disconnect(); }catch(_){}
    if(ctx && ctx.waitUntil) ctx.waitUntil(_workerError(env, 'browserTakeover', e));
    return json({ error:'That did not reach AMV’s browser. Try again.', code:'takeover_failed' }, 502);
  }
}

/* ── TEACH AMV BY SHOWING IT (audit #34) ─────────────────────────────────

   "Watch me do this." AMV's browser is opened at a site the person names and
   handed straight to them - the same takeover as above, the same isolation,
   the same ten minutes - and each click and each thing typed comes back
   described: what was clicked, which field, what went in it. The page keeps
   the steps (web-live.js) and, when they finish, turns them into a draft
   skill they read, change and save, or throw away. Nothing is kept here.

   What is NEVER part of a step: the text typed into a password or one-time
   code field, a card number or its security code. Those steps say that
   something secret was typed, and the skill asks the person for it when it
   runs. Labels come from the page, so they are bounded and treated as the
   page's words, not instructions - the person reviews every one before it
   becomes a skill, and a skill runs through the browser tool with all of its
   checks. The browser's held time is charged, as when a run hands it over. */
const WEB_TEACH_LABEL = 80;
const WEB_TEACH_TEXT = 200;
/* What the element at a point, or the focused one, is - a string, because
   page.evaluate runs it in the page. Climbs to the nearest thing a person
   would name: a link, a button, a field. */
function _webTeachDescribe(sel){
  return '(() => { let el = ' + sel + '; if(!el) return null;'
    + ' const near = el.closest ? el.closest("a,button,input,select,textarea,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option]") : null; if(near) el = near;'
    + ' const t = (s) => String(s || "").replace(/\\s+/g, " ").trim().slice(0, ' + WEB_TEACH_LABEL + ');'
    + ' const a = (n) => (el.getAttribute && el.getAttribute(n)) || "";'
    + ' let label = a("aria-label") || a("placeholder") || a("title") || a("alt");'
    + ' if(!label && el.labels && el.labels[0]) label = el.labels[0].innerText;'
    + ' if(!label && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") label = el.innerText;'
    + ' if(!label) label = a("name");'
    + ' return { tag: t(el.tagName).toLowerCase(), type: t(a("type") || el.type).toLowerCase(), role: t(a("role")), label: t(label), ac: t(a("autocomplete")).toLowerCase(),'
    + ' find: { id: t(el.id), testid: t(a("data-testid")), name: t(a("name")), aria: t(a("aria-label")), ph: t(a("placeholder")) } }; })()';
}
/* A field whose contents must never be recorded. Judged from the field, not
   from what was typed into it. */
function _webTeachSecret(el){
  if(!el) return false;
  if(el.type === 'password') return true;
  if(/password|one-time-code|cc-number|cc-csc|cc-exp/.test(el.ac || '')) return true;
  return /password|passcode|\bpin\b|cvv|cvc|security code|one[- ]time|verification code|card number/i.test(el.label || '');
}
function _webTeachStep(act, el){
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const what = el ? { tag: clip(el.tag, 20), type: clip(el.type, 20), label: clip(el.label, WEB_TEACH_LABEL) } : { tag: '', type: '', label: '' };
  /* How to find it again (78-teach-replay.js): the page's own handles for it,
     bounded, alongside the label it was clicked by. */
  if(el && el.find && typeof el.find === 'object'){
    const f = {};
    for(const k of ['id', 'testid', 'name', 'aria', 'ph']){ const v = clip(el.find[k], 120); if(v) f[k] = v; }
    if(what.label) f.label = what.label;
    if(Object.keys(f).length) what.find = f;
  } else if(what.label) what.find = { label: what.label };
  if(act.kind === 'click') return Object.assign({ kind: 'click' }, what);
  if(_webTeachSecret(el)) return Object.assign({ kind: 'type', secret: true }, what);
  return Object.assign({ kind: 'type', text: clip(act.text, WEB_TEACH_TEXT) }, what);
}
/* Where a step happened: the site and the path, never the query string -
   that is where tokens and personal details travel. */
function _webTeachWhere(url){
  try{ const u = new URL(url); return (u.host + u.pathname).slice(0, 200); }catch(e){ return ''; }
}

async function browserTeach(request, env, ctx){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'Sign in to teach AMV.' }, 401);
  const limited = await guardAction(env, 'webteach:' + user.email, 3, 30, 'teaching sessions');
  if(limited) return limited;
  const body = await request.json().catch(() => ({}));
  const gate = _webHostAllowed(body.url);
  if(!gate.ok) return json({ error: gate.why, code:'blocked_url' }, 400);
  if(!env.BROWSER) return json({ error:'AMV’s browser is not enabled on this deployment, so it cannot be taught here.', code:'needs_service' }, 503);
  if(!connConfigured(env)) return json({ error:'AMV’s browser cannot be handed to you on this deployment (no sealing key is set).', code:'needs_service' }, 503);
  const holdUSD = (WEB_HOLD_MS / 3600000) * WEB_BROWSER_USD_PER_HOUR;
  const book = {};
  const refused = await _spendGate(env, user, 'webteach', holdUSD, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
  if(refused) return refused;
  const subject = user.billingSubject || user.email;
  const giveBack = () => _recordSpend(env, subject, 0, 'webteach', book.period, book).catch(() => {});
  let browser = null;
  try{
    try{ browser = await _webLaunch(env, { keep_alive: WEB_HOLD_MS }); }
    catch(e){ await giveBack(); return json({ error:'AMV’s browser could not be started. Try again in a moment.', code:'needs_service' }, 503); }
    if(typeof browser.sessionId !== 'function' || typeof browser.disconnect !== 'function'){
      await browser.close().catch(() => {}); await giveBack();
      return json({ error:'AMV’s browser on this deployment cannot be handed to you.', code:'needs_service' }, 503);
    }
    const page = await browser.newPage();
    await page.setViewport({ width:1280, height:900 });
    const denied = [];
    const isolated = await _webIsolate(page, (url, why, kind) => { if(denied.length < 5) denied.push({ url:String(url).slice(0, 200), why, kind }); });
    if(!isolated){ await browser.close().catch(() => {}); await giveBack(); return json({ error:'AMV’s browser cannot be used safely on this deployment right now.', code:'needs_service' }, 503); }
    const jarIn = _webJarIn(body.cookies);
    if(jarIn.length && typeof page.setCookie === 'function') await page.setCookie(...jarIn).catch(() => {});
    await page.goto(gate.url, { waitUntil:'domcontentloaded', timeout:20000 }).catch(() => {});
    const here = await page.url().catch(() => '');
    const g = here ? _webHostAllowed(here) : { ok:false, why:'' };
    if(!g.ok || denied.length && !String(here).startsWith('http')){
      await browser.close().catch(() => {}); await giveBack();
      return json({ ok:false, code:'blocked_url', error:'That address sent AMV somewhere it is not allowed to go, so nothing was opened. ' + (g.why || (denied[0] && denied[0].why) || '') }, 400);
    }
    let shot = '';
    try{ shot = await page.screenshot({ type:'jpeg', quality:45, encoding:'base64' }); }catch(e){}
    const handle = await _webTakeSeal(env, user.email, browser.sessionId(), here, true);
    await browser.disconnect().catch(() => {});
    browser = null;
    await _recordSpend(env, subject, holdUSD, 'webteach', book.period, book);
    audit(env, 'web_teach_start', { by: user.email, site: _webTeachWhere(here).split('/')[0] });
    return json({ ok:true, handle, url: here.slice(0, 500), at: _webTeachWhere(here), shot: shot.length <= WEB_SHOT_MAX ? shot : '', forMs: WEB_HOLD_MS });
  }catch(e){
    if(browser) await browser.close().catch(() => {});
    await giveBack();
    if(ctx && ctx.waitUntil) ctx.waitUntil(_workerError(env, 'browserTeach', e));
    return json({ error:'AMV’s browser could not be opened for teaching. Try again.', code:'teach_failed' }, 502);
  }
}
