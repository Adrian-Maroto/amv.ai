/* ============================================================
   AMV.AI — automated test suite
   Loads the real built app in a headless browser and exercises
   the critical paths: state store, auth, billing/profit math,
   plan gating, integrations, and rendering of every view.

   Run:  node tests/run-tests.mjs
   (requires playwright: npm i -D playwright && npx playwright install chromium)
   ============================================================ */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(__dirname, '..', 'index.html');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond){ if(cond){ pass++; console.log('  \x1b[32m\u2713\x1b[0m '+name); } else { fail++; failures.push(name); console.log('  \x1b[31m\u2717 '+name+'\x1b[0m'); } }
function eq(name, a, b){ ok(name + '  ('+JSON.stringify(a)+' === '+JSON.stringify(b)+')', a===b); }

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1280, height:880 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0,160)));

  await page.goto(APP);
  await page.waitForTimeout(900);
  await page.evaluate(() => { localStorage.clear(); });

  /* ---------- 1. STATE STORE ---------- */
  console.log('\n\x1b[36mState store\x1b[0m');
  ok('S is defined', await page.evaluate(() => typeof S !== 'undefined'));
  ok('AMVState is defined', await page.evaluate(() => typeof AMVState !== 'undefined'));
  eq('S.model write persists', await page.evaluate(() => { S.model='core'; return loadStr('amv_model'); }), 'core');
  ok('subscription fires on change', await page.evaluate(() => { let got=null; AMVState.subscribe('tab', v=>got=v); S.tab='images'; return got==='images'; }));
  ok('AMVState.set updates + persists', await page.evaluate(() => { AMVState.set('imgStyle','Anime'); return S.imgStyle==='Anime' && loadStr('amv_imgstyle')==='Anime'; }));

  /* ---------- 2. AUTH ---------- */
  console.log('\n\x1b[36mAuth\x1b[0m');
  await page.evaluate(() => localStorage.clear());
  ok('createAccount returns account', await page.evaluate(async () => { const a = await createAccount('Test User','Test@X.com','secret123'); return !!a && a.email==='test@x.com'; }));
  ok('findAccount is case-insensitive', await page.evaluate(() => !!findAccount('TEST@x.COM')));
  ok('verifyLogin accepts correct password', await page.evaluate(async () => !!(await verifyLogin('test@x.com','secret123'))));
  ok('verifyLogin rejects wrong password', await page.evaluate(async () => null === (await verifyLogin('test@x.com','WRONG'))));
  ok('verifyLogin rejects unknown email', await page.evaluate(async () => null === (await verifyLogin('nobody@x.com','x'))));
  ok('initials generated correctly', await page.evaluate(() => { const a = findAccount('test@x.com'); return a.ini==='TU'; }));
  ok('password is hashed, not stored raw', await page.evaluate(() => { const a = findAccount('test@x.com'); return a.pwHash && a.pwHash!=='secret123'; }));

  /* ---------- 3. BILLING / PROFIT MATH ---------- */
  console.log('\n\x1b[36mProfit math (must never lose money)\x1b[0m');
  const prices = [10, 30, 75, 200, 500, 1000, 5000];
  for(const pr of prices){
    const margin = await page.evaluate((price) => {
      const s = _customPlanSummary(price);
      return s ? Math.round((s.margin||((price - s.worstCost)/price))*100) : null;
    }, pr);
    ok('custom $'+pr+' margin >= 55% (got '+margin+'%)', margin!==null && margin>=55);
  }
  ok('credits scale with price', await page.evaluate(() => {
    const a=_customPlanSummary(10), b=_customPlanSummary(200);
    return b.credits > a.credits;
  }));

  /* ---------- 4. PLAN GATING ---------- */
  console.log('\n\x1b[36mPlan gating\x1b[0m');
  ok('free plan blocks premium model', await page.evaluate(() => { saveStr('amv_plan','free'); return _planAllowsModel('smart')===false; }));
  ok('free plan allows auto', await page.evaluate(() => { saveStr('amv_plan','free'); return _planAllowsModel('auto')===true; }));
  ok('custom plan allows all models', await page.evaluate(() => { saveStr('amv_plan','custom'); return _planAllowsModel('smart')===true; }));
  ok('PLAN_RANK orders plans', await page.evaluate(() => PLAN_RANK.elite > PLAN_RANK.pro && PLAN_RANK.pro > PLAN_RANK.free));

  /* ---------- 5. OWNER / USER BOUNDARY ---------- */
  console.log('\n\x1b[36mSecurity boundary\x1b[0m');
  ok('no owner flag => not admin', await page.evaluate(() => { localStorage.removeItem('amv_owner'); return isAdmin()===false; }));
  ok('owner flag => admin', await page.evaluate(() => { saveStr('amv_owner','1'); return isAdmin()===true; }));
  ok('live backend forces non-admin', await page.evaluate(() => { saveStr('amv_owner','1'); saveStr('amv_api_base','https://x.dev'); const r=isAdmin(); localStorage.removeItem('amv_api_base'); return r===false; }));

  /* ---------- 6. INTEGRATIONS ---------- */
  console.log('\n\x1b[36mIntegrations\x1b[0m');
  ok('INTEGRATION_META has google', await page.evaluate(() => !!INTEGRATION_META.google));
  ok('connectIntegration is callable', await page.evaluate(() => typeof connectIntegration==='function'));
  ok('disconnect clears stored key', await page.evaluate(() => { saveStr('amv_notion','x'); disconnectIntegration('notion'); return !loadStr('amv_notion'); }));
  ok('_oauthUrl builds a provider url', await page.evaluate(() => _oauthUrl('github','CID').includes('github.com/login/oauth')));

  /* ---------- 6b. INTENT-AWARE TASK VALIDATION (Task #1) ---------- */
  console.log('\n\x1b[36mIntent-aware task validation\x1b[0m');
  await page.evaluate(() => { localStorage.removeItem('amv_gtoken'); localStorage.removeItem('amv_slack'); localStorage.removeItem('amv_github'); });
  ok('gmail task NOT ready when disconnected', await page.evaluate(() => analyzeTaskIntent('reply to my email').ready===false));
  ok('gmail task names Gmail API as missing', await page.evaluate(() => analyzeTaskIntent('reply to my email').missing.some(m=>m.api==='Gmail API')));
  ok('slack task NOT ready when disconnected', await page.evaluate(() => analyzeTaskIntent('post to slack channel').ready===false));
  ok('unsupported integration flagged (Notion)', await page.evaluate(() => analyzeTaskIntent('create a notion page').unsupported.some(u=>u.integration==='Notion')));
  ok('requirement message is specific', await page.evaluate(() => taskRequirementMessage(analyzeTaskIntent('send an email')).includes('Gmail API')));
  ok('gmail task READY when connected', await page.evaluate(() => { saveStr('amv_gtoken','tok'); const r=analyzeTaskIntent('send an email to my boss').ready; localStorage.removeItem('amv_gtoken'); return r===true; }));
  ok('non-integration task does not match', await page.evaluate(() => analyzeTaskIntent('write me a poem').matched===false));
  ok('mixed task blocked if one part missing', await page.evaluate(() => { saveStr('amv_gtoken','tok'); const r=analyzeTaskIntent('read my email then post to slack'); localStorage.removeItem('amv_gtoken'); return r.ready===false && r.missing.some(m=>m.integration==='Slack'); }));

  /* ---------- 6c. TEAMS PLAN GATING (Task #3) ---------- */
  console.log('\n\x1b[36mTeams plan gating\x1b[0m');
  ok('free plan does NOT allow teams', await page.evaluate(() => { saveStr('amv_plan','free'); return _planAllowsTeams()===false; }));
  ok('pro plan does NOT allow teams', await page.evaluate(() => { saveStr('amv_plan','pro'); return _planAllowsTeams()===false; }));
  ok('elite plan does NOT allow teams', await page.evaluate(() => { saveStr('amv_plan','elite'); return _planAllowsTeams()===false; }));
  ok('ultra plan ALLOWS teams', await page.evaluate(() => { saveStr('amv_plan','ultra'); return _planAllowsTeams()===true; }));
  ok('team required plan is ultra', await page.evaluate(() => TEAM_REQUIRED_PLAN==='ultra'));

  /* ---------- 6d. SUPPORT EMAIL (Task #5) ---------- */
  console.log('\n\x1b[36mSupport email\x1b[0m');
  ok('no email => support button falls back (no mailto)', await page.evaluate(() => { localStorage.removeItem('amv_support_email'); return supportButton({}).includes('data-dact="askAmv"') && !supportButton({}).includes('mailto:'); }));
  ok('set email => support button is mailto', await page.evaluate(() => { setSupportEmail('help@x.com'); return supportButton({}).includes('mailto:help@x.com'); }));
  ok('support button includes prefilled subject', await page.evaluate(() => { setSupportEmail('help@x.com'); return supportButton({subject:'Hi'}).includes('subject='); }));
  ok('invalid email is rejected', await page.evaluate(() => { setSupportEmail('good@x.com'); const r=setSupportEmail('bad'); return r===false && _supportEmail()==='good@x.com'; }));
  ok('email persists globally', await page.evaluate(() => { setSupportEmail('p@x.com'); return loadStr('amv_support_email')==='p@x.com'; }));
  await page.evaluate(() => localStorage.removeItem('amv_support_email'));

  /* ---------- 6e. ROLLING USAGE WINDOW (Task #7) ---------- */
  console.log('\n\x1b[36mRolling usage window\x1b[0m');
  ok('fresh window starts at 0 used', await page.evaluate(() => { localStorage.removeItem(_scopeKey('amv_usage_window')); return AMVUsage.status().used===0; }));
  ok('window is 5 hours', await page.evaluate(() => AMVUsage.status().windowHours===5));
  ok('recording tokens increases usage', await page.evaluate(() => { localStorage.removeItem(_scopeKey('amv_usage_window')); AMVUsage.record(1000); return AMVUsage.status().used===1000; }));
  ok('pct computed against cap', await page.evaluate(() => { saveStr('amv_plan','free'); localStorage.removeItem(_scopeKey('amv_usage_window')); const cap=AMVUsage.status().cap; AMVUsage.record(Math.round(cap/2)); return Math.abs(AMVUsage.status().pct-50)<=2; }));
  ok('expired window auto-resets', await page.evaluate(() => { let w={start:Date.now()-6*3600*1000,used:9999,reqs:5}; store('amv_usage_window',w); return AMVUsage.status().used===0; }));
  ok('resetLabel returns a countdown', await page.evaluate(() => { localStorage.removeItem(_scopeKey('amv_usage_window')); AMVUsage.record(10); return /h |m|minute/.test(AMVUsage.resetLabel()); }));
  ok('heavier plan has bigger cap', await page.evaluate(() => { saveStr('amv_plan','free'); const f=AMVUsage.status().cap; saveStr('amv_plan','ultra'); localStorage.removeItem(_scopeKey('amv_usage_window')); const u=AMVUsage.status().cap; saveStr('amv_plan','free'); return u>f; }));
  ok('remaining never goes negative', await page.evaluate(() => { localStorage.removeItem(_scopeKey('amv_usage_window')); AMVUsage.record(AMVUsage.status().cap*3); return AMVUsage.status().remaining===0; }));
  await page.evaluate(() => { localStorage.removeItem(_scopeKey('amv_usage_window')); saveStr('amv_plan','free'); });

  /* ---------- 7. RENDERING — every view, zero errors ---------- */
  console.log('\n\x1b[36mRendering (all views)\x1b[0m');
  await page.evaluate(() => { localStorage.clear(); S.user={name:'A',email:'a@b.com',ini:'A'}; try{ hideIntro&&hideIntro(); document.getElementById('land').classList.add('hidden'); goApp(); }catch(e){} });
  await page.waitForTimeout(300);
  const views = ['chat','images','video','crew','handoff','studio','dev','lab','projects','memory','integrations','tasks','settings','billing','apps'];
  for(const v of views){
    const before = pageErrors.length;
    await page.evaluate((vv) => setTab(vv), v);
    await page.waitForTimeout(90);
    ok('view "'+v+'" renders without error', pageErrors.length===before);
  }
  const panes = ['account','security','privacy','appearance','language','integrations','about'];
  await page.evaluate(() => setTab('settings'));
  for(const pane of panes){
    const before = pageErrors.length;
    await page.evaluate((pp) => { S.settingsPane=pp; renderSetPane(); }, pane);
    await page.waitForTimeout(70);
    ok('settings pane "'+pane+'" renders', pageErrors.length===before);
  }

  /* ---------- 8. NO UNCAUGHT ERRORS OVERALL ---------- */
  console.log('\n\x1b[36mGlobal\x1b[0m');
  ok('zero uncaught page errors during suite', pageErrors.length===0);
  if(pageErrors.length) console.log('   errors:', pageErrors.slice(0,5));

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('\x1b[1m'+pass+' passed, '+fail+' failed\x1b[0m  ('+(pass+fail)+' tests)');
  if(fail){ console.log('\x1b[31mFailures:\x1b[0m'); failures.forEach(f=>console.log('  - '+f)); process.exit(1); }
  else console.log('\x1b[32mAll tests passed.\x1b[0m');
};

run().catch(e => { console.error('Test runner crashed:', e); process.exit(1); });
