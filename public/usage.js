/* THE USAGE SCREEN - fetched the first time somebody opens it (_usageLoad in
   07-workspace-memory.js), the way library.js and the sell form are. A classic
   script, so it shares the page's helpers and state. Most visits never open
   Usage, and the page ships to every one of them: moving this out is what kept
   the page under its weight ceiling rather than raising it (the October 24
   audit asked for exactly that). */
/* === USAGE / VALUE DASHBOARD === */
/* Shared usage content - used by the standalone view AND the Settings pane,
   so they never drift. Returns inner HTML (no outer .sv/.vi wrapper). */
function _usageContentHTML(){
  const mc=getMsgs().length;
  const week=AMVValue.stats(7), all=AMVValue.stats(null);
  const typeLabel={message:'Conversations',code:'Code tasks',document:'Documents',agent_action:'Autonomous actions',research:'Research',design:'Designs'};
  const breakdown=Object.entries(all.byType).sort((a,b)=>b[1]-a[1]).map(([t,n])=>
    '<div class="vrow"><span>'+(typeLabel[t]||t)+'</span><span class="vrow-n">'+n+'</span></div>').join('')||'<div class="vrow"><span style="color:var(--mu)">Nothing yet - start a chat to see your impact grow.</span></div>';
  // --- Task #7: rolling usage window ---
  const us=AMVUsage.status();
  const srvOwned=_usageServerOwned();
  const planName=(PLANS[loadStr('amv_plan')||'free']&&PLANS[loadStr('amv_plan')||'free'].name)||'Free';
  const barColor = us.pct>=90 ? '#ff4d4d' : (us.pct>=70 ? '#e0b341' : 'var(--accent)');
  const usagePanel=
    '<div class="ss2 usage-panel"><h3>Current usage</h3>'+
      '<div class="usage-head">'+
        '<div><div class="usage-pct">'+(100-us.pct)+'%</div><div class="usage-pct-l">remaining on your '+planName+' plan</div></div>'+
        '<div class="usage-reset"><div class="usage-reset-n">'+AMVUsage.resetLabel()+'</div><div class="usage-reset-l">until usage resets</div></div>'+
      '</div>'+
      '<div class="usage-meta">'+
        '<span>'+us.used.toLocaleString()+' / '+us.cap.toLocaleString()+' used this window</span>'+
        '<span>'+us.reqs+' request'+(us.reqs===1?'':'s')+' &middot; resets every '+us.windowHours+'h</span>'+
      '</div>'+
      (us.pct>=90?'<div class="usage-warn">You\u2019re nearly out for this window. It refreshes in '+AMVUsage.resetLabel()+', or <a data-stab="plans" style="color:var(--accent-txt);cursor:pointer">upgrade for more &rarr;</a></div>':'')+
      '<p class="usage-note">'+escH(T('Counted on this device, because this AMV has no server to count it.'))+'</p>'+
    '</div>';
  // --- 14-day activity trend chart ---
  const _daily=AMVValue.daily(14);
  const _maxDay=Math.max(1,..._daily.map(d=>d.count));
  const _totalDays=_daily.reduce((a,d)=>a+d.count,0);
  const _trendBars=_daily.map(d=>{
    const h=Math.round((d.count/_maxDay)*100);
    const dObj=new Date(d.day+'T00:00:00');
    const label=dObj.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return '<div class="trend-col" title="'+label+': '+d.count+' task'+(d.count===1?'':'s')+'"><div class="trend-bar-wrap"><div class="trend-bar" style="height:'+Math.max(h,3)+'%"></div></div><div class="trend-lbl">'+dObj.getDate()+'</div></div>';
  }).join('');
  const trendPanel=
    '<div class="ss2"><h3>Activity over time</h3>'+
      '<p class="vsub" style="margin-bottom:14px">Your last 14 days \u00b7 '+_totalDays+' task'+(_totalDays===1?'':'s')+' total</p>'+
      '<div class="trend-chart">'+_trendBars+'</div>'+
    '</div>';
  /* The server's own numbers, filled in asynchronously. These are the limits
     that can actually refuse a request; everything else on this screen is a
     device-local tally that the server has never seen. The distinction is
     stated on the panel rather than left for the user to discover when the two
     disagree. */
  const serverPanel = (window.AMV_API && AMV_API.live && AMV_API.hasSession)
    ? '<div class="ss2" id="srv-usage"><h3>Your plan allowance</h3><div class="srv-load">Loading your real usage\u2026</div></div>'
    : '';
  setTimeout(_paintServerUsage, 0);
  return ''+
      serverPanel+
      '<div class="vhero">'+
        '<div class="vcard vcard-accent"><div class="vcard-n">'+all.hoursSaved+'<span class="vcard-u">hrs</span></div><div class="vcard-l">Time saved (all time)</div></div>'+
        '<div class="vcard"><div class="vcard-n">'+all.total+'</div><div class="vcard-l">Tasks completed</div></div>'+
        '<div class="vcard"><div class="vcard-n">'+week.hoursSaved+'<span class="vcard-u">hrs</span></div><div class="vcard-l">Saved this week</div></div>'+
        '<div class="vcard"><div class="vcard-n">'+S.memory.length+'</div><div class="vcard-l">Things AMV remembers</div></div>'+
      '</div>'+
      (srvOwned ? '' : usagePanel)+
      trendPanel+
      '<div class="ss2"><h3>What you\u2019ve used</h3><div class="vbreak">'+breakdown+'</div></div>'+
      /* THIS DEVICE, said as this device.

         It used to read "Messages 12 / 30" and "Images 2 / 4" against numbers
         that are true on no plan at all - the real image cap is 100 a day on
         Pro and 2000 on Ultra. So a paying customer was shown a limit five
         hundred times smaller than the one they had bought, on the screen they
         open to find out what they have left. The real figures are in the
         panel above, from the server; this is a local tally and now says so
         instead of inventing a ceiling. */
      '<div class="ss2"><h3>On this device</h3>'+
        '<p class="vsub" style="margin-bottom:12px">What this browser has done in this session. Your real allowance is above, counted by AMV\u2019s servers.</p>'+
        '<div class="vbreak">'+
          '<div class="vrow"><span>Conversations</span><span class="vrow-n">'+mc+'</span></div>'+
        '</div>'+
        '<button class="btn bp" data-stab="plans" style="margin-top:14px;font-size:var(--t-sm)">See plans &rarr;</button>'+
      '</div>'+
      (isAdmin()? (function(){var u=AEGIS.usage();var cap=AEGIS.cfg.dailyTokenCap;var used=u.inTok+u.outTok;var pct=Math.min(used/cap*100,100);return '<div class="ss2" style="margin-top:18px"><h3>Token usage &amp; cost (today) - operator</h3>'+'<div class="stg" style="margin-bottom:12px">'+'<div class="stc"><div class="stv">'+u.reqs+'</div><div class="stl">API requests</div></div>'+'<div class="stc"><div class="stv">'+u.inTok.toLocaleString()+'</div><div class="stl">Input tokens</div></div>'+'<div class="stc"><div class="stv">'+u.outTok.toLocaleString()+'</div><div class="stl">Output tokens</div></div>'+'<div class="stc"><div class="stv">$'+u.costUSD.toFixed(3)+'</div><div class="stl">Est. cost</div></div>'+'</div>'+'<div><div style="display:flex;justify-content:space-between;font-size:var(--t-sm);color:var(--mu);margin-bottom:4px"><span>Daily token cap (this device)</span><span>'+used.toLocaleString()+' / '+cap.toLocaleString()+'</span></div><div class="sbb"><div class="sbf2" style="width:'+pct+'%"></div></div></div>'+'<div style="display:flex;gap:8px;margin-top:12px"><button class="btn bs" data-dact="aegisExport" style="font-size:var(--t-sm)">Export audit log</button><button class="btn bs" data-dact="aegisClear" style="font-size:var(--t-sm)">Clear log</button></div>'+'</div>';})() : '');
}
window._usageContentHTML=_usageContentHTML;

/* WHERE IT WENT: this calendar month's tokens by surface and by project, as
   the server counted them. Projects come back as ids; this device names the
   ones it has, says plainly when one lives on another device, and counts the
   rest of the month as outside any project. */
const _USAGE_SURFACE_LABEL = { chat:'Chat', crew:'Crew', build:'Build', code:'Code', voice:'Voice', automation:'Automations',
  api:'API keys', batch:'Batches', widget:'Website widget', other:'Other' };
function _whereHTML(B, n){
  const cur = B && B.current;
  if(!cur || !(cur.tokens > 0)) return '';
  const rows = (pairs) => {
    const top = Math.max(1, ...pairs.map(p => p[1]));
    return pairs.map(([lbl, v]) => '<div class="life-mo"><span>'+escH(lbl)+'</span><span class="life-bar"><span style="width:'+Math.round(v / top * 100)+'%"></span></span><span>'+n(v)+'</span></div>').join('');
  };
  const surf = Object.entries(cur.surfaces || {}).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [T(_USAGE_SURFACE_LABEL[k] || 'Other'), v]);
  let inProj = 0;
  const proj = Object.entries(cur.projects || {}).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => {
    inProj += v;
    if(id === '_other') return [T('Other projects'), v];
    let ws = null; try{ ws = _wsById(id); }catch(e){}
    return [ws && ws.name ? ws.name : T('A project on another device'), v];
  });
  const outside = cur.tokens - inProj;
  if(proj.length && outside > 0) proj.push([T('Not in a project'), outside]);
  const prev = B.previous && B.previous.tokens > 0 ? '<div class="srv-when">'+escH(T('Last month: {0} tokens').replace('{0}', n(B.previous.tokens)))+'</div>' : '';
  return '<h4 class="life-h">'+escH(T('Where it went this month'))+'</h4>'+
    '<div class="srv-when">'+escH(T('Calendar month, UTC'))+'</div>'+
    rows(surf)+prev+
    (proj.length ? '<h4 class="life-h">'+escH(T('By project'))+'</h4>'+rows(proj) : '');
}
/* ALL TIME (docs/OWNER-DECISIONS.md #14): this person's totals since counting
   began, the last twelve months, and which engines did the work. Totals only -
   the server keeps nothing of what was asked to make these. */
function _lifeHTML(L, n){
  if(!L || !(L.messages > 0)) return '';
  let since = '';
  try{ since = L.since ? new Date(L.since).toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' }) : ''; }catch(e){}
  const top = Math.max(1, ...(L.months || []).map(m => m.tokens || 0));
  const months = (L.months || []).map(m => {
    let lbl = m.month; try{ lbl = new Date(m.month + '-01T00:00:00Z').toLocaleDateString([], { month:'short', year:'2-digit', timeZone:'UTC' }); }catch(e){}
    return '<div class="life-mo"><span>'+escH(lbl)+'</span><span class="life-bar"><span style="width:'+Math.round((m.tokens||0)/top*100)+'%"></span></span><span>'+n(m.messages)+'</span></div>';
  }).join('');
  const total = Object.values(L.engines || {}).reduce((a, b) => a + (+b || 0), 0) || 1;
  const engines = Object.entries(L.engines || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    '<div class="srv-lbl"><span>'+escH((typeof ENGINE_LABEL !== 'undefined' && ENGINE_LABEL[k]) || k)+'</span><span>'+Math.round(v / total * 100)+'%</span></div>').join('');
  return '<h4 class="life-h">'+escH(T('All time'))+'</h4>'+
    '<div class="srv-lbl"><span>'+escH(T('Messages'))+'</span><span>'+n(L.messages)+'</span></div>'+
    '<div class="srv-lbl"><span>'+escH(T('Tokens'))+'</span><span>'+n(L.tokens)+'</span></div>'+
    (since ? '<div class="srv-when">'+escH(T('Counted since {0}').replace('{0}', since))+'</div>' : '')+
    (months ? '<h4 class="life-h">'+escH(T('By month (messages)'))+'</h4>'+months : '')+
    (engines ? '<h4 class="life-h">'+escH(T('By engine'))+'</h4>'+engines : '');
}
/* Fills the server-truth panel once the numbers arrive. Kept out of the HTML
   builder so a slow or failed request never delays the rest of the screen. */
function _paintServerUsage(){
  const host = document.getElementById('srv-usage');
  if(!host || !(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
  _srvUsageRefresh(true).then(d=>{
    if(!d || !d.day || !d.month){
      host.innerHTML = '<h3>Your plan allowance</h3><div class="srv-off">Your real allowance is unavailable right now. The figures below are this device\u2019s own tally.</div>';
      return;
    }
    const bar = (used, cap) => {
      const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
      const col = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--gold)' : 'var(--accent)';
      return '<div class="sbb"><div class="sbf2" style="width:'+pct+'%;background:'+col+'"></div></div>';
    };
    const n = v => (+v || 0).toLocaleString();
    const bonus = +(d.month.bonus || 0);
    const when = at => '<div class="srv-when">'+escH(_usageResetWords(at))+'</div>';
    const inc = d.included || { pct: d.month.limit > 0 ? Math.min(100, Math.round(d.month.used / d.month.limit * 100)) : 0, resetAt: d.month.resetAt };
    const w5 = d.window5h || {}, top = d.topEngineWeek || {};
    host.innerHTML =
      '<h3>Your plan allowance</h3>'+
      '<p class="srv-sub">Counted by AMV\u2019s servers - these are the limits that actually apply.</p>'+
      '<div class="srv-row"><div class="srv-lbl"><span>'+escH(T('This month'))+'</span><span>'+escH(T('{0}% used').replace('{0}', inc.pct))+'</span></div>'+bar(inc.pct, 100)+when(inc.resetAt)+
        (inc.by === 'cost' ? '<div class="srv-why">'+escH(T('The engines you used cost more than average, so the month is further along than its token count.'))+'</div>' : '')+'</div>'+
      (w5.limit > 0 ? '<div class="srv-row"><div class="srv-lbl"><span>'+escH(T('5-hour window'))+'</span><span>'+escH(T('{0} of {1} messages').replace('{0}', n(w5.used)).replace('{1}', n(w5.limit)))+'</span></div>'+bar(w5.used, w5.limit)+
        (w5.resetAt ? when(w5.resetAt) : '<div class="srv-when">'+escH(T('Starts with your next message and lasts 5 hours'))+'</div>')+'</div>' : '')+
      '<div class="srv-row"><div class="srv-lbl"><span>'+escH(T('Today'))+'</span><span>'+escH(T('{0} of {1} tokens').replace('{0}', n(d.day.used)).replace('{1}', n(d.day.limit)))+'</span></div>'+bar(d.day.used, d.day.limit)+when(d.day.resetAt)+'</div>'+
      (top.limit > 0 ? '<div class="srv-row"><div class="srv-lbl"><span>'+escH(T('Top engine this week'))+'</span><span>'+escH(T('{0} of {1} messages').replace('{0}', n(top.used)).replace('{1}', n(top.limit)))+'</span></div>'+bar(top.used, top.limit)+when(top.resetAt)+'</div>' : '')+
      '<details class="srv-more"><summary>'+escH(T('Details'))+'</summary>'+
        '<div class="srv-lbl"><span>'+escH(T('Tokens this month'))+'</span><span>'+n(d.month.used)+' / '+n(d.month.limit)+'</span></div>'+
        '<div class="srv-lbl"><span>'+escH(T('Messages this month'))+'</span><span>'+n(d.messages && d.messages.used)+'</span></div>'+
        _whereHTML(d.breakdown, n)+
        _lifeHTML(d.lifetime, n)+
      '</details>'+
      (bonus > 0
        ? '<div class="srv-bonus">Includes <b>+'+n(bonus)+'</b> bonus tokens from invites you have earned. '+
          '<a data-sp-go="invite" style="color:var(--accent-txt);cursor:pointer">See your invites &rarr;</a></div>'
        : '')+
      (d.shared && d.shared.team
        ? '<div class="srv-bonus">These numbers are your <b>whole team</b>, not just you - one subscription is one allowance, '+
          'however many people are on it. <a data-sp-team="1" style="color:var(--accent-txt);cursor:pointer">Open Team &rarr;</a></div>'
        : '')+
      '<p class="srv-note">Your plan is '+escH(String(d.plan||'free'))+'. '+escH(T('Each limit is separate: running out today does not spend your month. Times are in your time zone.'))+'</p>';
    const go = host.querySelector('[data-sp-go]');
    if(go) on(go,'click',()=>{ S.settingsPane='invite'; S.tab='settings'; setTab('settings'); });
    const tm = host.querySelector('[data-sp-team]');
    if(tm) on(tm,'click',()=>{ S.tab='team'; setTab('team'); });
  }).catch(()=>{
    host.innerHTML = '<h3>Your plan allowance</h3><div class="srv-off">Could not reach the server, so your real allowance is not shown. The figures below are this device\u2019s own tally.</div>';
  });
}
try{ window._paintServerUsage=_paintServerUsage; }catch(e){}
try{ window._usageContentHTML=_usageContentHTML; window._lifeHTML=_lifeHTML; window._whereHTML=_whereHTML; }catch(e){}
