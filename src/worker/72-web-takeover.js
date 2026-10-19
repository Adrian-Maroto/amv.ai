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

async function _webTakeSeal(env, email, sessionId, url){
  return connSeal(env, { t: 'webtake', e: String(email).toLowerCase(), s: String(sessionId), x: Date.now() + WEB_HOLD_MS, u: String(url || '').slice(0, 500) });
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
    return json({ ok:true, url: here.slice(0, 500), shot: shot.length <= WEB_SHOT_MAX ? shot : '', blockedRequests: denied.length });
  }catch(e){
    try{ await browser.disconnect(); }catch(_){}
    if(ctx && ctx.waitUntil) ctx.waitUntil(_workerError(env, 'browserTakeover', e));
    return json({ error:'That did not reach AMV’s browser. Try again.', code:'takeover_failed' }, 502);
  }
}
