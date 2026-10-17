/* THE WEBSITE WIDGET'S SETTINGS FORM, fetched the first time the pane is
   opened (`_widgetFormLoad` in 12b-settings.js). Only somebody putting AMV on
   their own site ever sees it, so nobody else carries it on every visit. It
   runs in the page's own scope, beside `_WIDGET_CFG` and the helpers it uses. */
function _widgetSnippet(cfg, base){
  const host=(base||'').replace(/\/+$/,'');
  // Prefer an explicit app origin if the operator serves the app separately;
  // default to same-origin as the Worker (works for combined deploys).
  const appOrigin=location.origin;
  return '<script src="'+host+'/widget.js?k='+cfg.key+'&host='+encodeURIComponent(appOrigin)+'" async><\/script>';
}
function _paintWidgetForm(body, cfg, base){
  const snippet=_widgetSnippet(cfg, base);
  const modelOpts=[['amv-pulse','Fast (cheapest)'],['amv-core','Balanced (recommended)'],['amv-swift','Fastest top engine'],['amv-forge','Advanced'],['amv-apex','Most capable']]
    .map(m=>'<option value="'+m[0]+'"'+(cfg.model===m[0]?' selected':'')+'>'+m[1]+'</option>').join('');
  body.innerHTML=
    '<div class="ss2"><h3>Your embed code</h3>'+
      '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:10px;line-height:1.6">Paste this once, just before <code>&lt;/body&gt;</code> on any page. The chat bubble appears in the corner. Changes you save here apply everywhere instantly - no need to re-paste.</p>'+
      '<div style="position:relative"><pre id="wg-snippet" style="background:var(--surface);border:1px solid var(--hair);border-radius:var(--r-sm);padding:12px 12px;font-size:var(--t-sm);overflow:auto;margin:0;white-space:pre-wrap;word-break:break-all"><code>'+escH(snippet)+'</code></pre></div>'+
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'+
        '<button class="btn bp" id="wg-copy" style="font-size:var(--t-sm)">Copy code</button>'+
        '<button class="btn" id="wg-preview" style="font-size:var(--t-sm)">Preview widget</button>'+
        '<span style="font-size:var(--t-xs);color:var(--mu);align-self:center">Site key: <code>'+escH(cfg.key)+'</code></span>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Appearance</h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">Header title</label><input type="text" id="wg-title" value="'+escH(cfg.title||'')+'" maxlength="60" placeholder="Chat with us"></div>'+
        '<div><label class="lbl">Greeting message</label><input type="text" id="wg-greeting" value="'+escH(cfg.greeting||'')+'" maxlength="300" placeholder="Hi! How can I help you today?"></div>'+
        '<div><label class="lbl">Accent color</label><input type="color" id="wg-accent" value="'+escH(cfg.accent||'#4f7cff')+'" style="width:60px;height:36px;padding:2px;cursor:pointer"></div>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Behavior</h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">AI model</label><select id="wg-model" class="inp">'+modelOpts+'</select></div>'+
        '<div><label class="lbl">Instructions (system prompt) - tells the AI how to behave and what it knows</label><textarea id="wg-sys" rows="4" style="font-family:inherit;font-size:var(--t-base)" placeholder="You are a helpful assistant for [your company]\u2026">'+escH(cfg.systemPrompt||'')+'</textarea></div>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Allowed domains <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(recommended)</span></h3>'+
      '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:10px;line-height:1.6">Lock the widget to your own sites so nobody can embed it elsewhere and use your quota. One domain per line (e.g. <code>example.com</code>). Leave empty to allow any site '+(!(cfg.origins&&cfg.origins.length)?'- <b style="color:var(--red-txt)">currently unrestricted</b>':'')+'.</p>'+
      '<textarea id="wg-origins" rows="3" style="font-family:var(--mn);font-size:var(--t-sm)" placeholder="example.com&#10;www.example.com">'+escH((cfg.origins||[]).join('\n'))+'</textarea>'+
    '</div>'+
    /* ZERO MEANS UNLIMITED, AND THE LABELS SAID "MAX".
       The server reads 0 on either of these as "no ceiling" - `dailyMsgCap > 0`
       and `dailySpendCapUSD > 0` are what gate the counters. The fields said
       "Max messages per day" with a minimum of 0 and nothing else, so the
       obvious reading of typing 0 is "none", and what it actually does is
       remove the only per-widget limit on the owner's bill. Said plainly here,
       and warned about live, because a money control that means the opposite of
       how it reads is not a control. */
    '<div class="ss2"><h3>Safety limits <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(protect your costs)</span></h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">Max messages per day <span class="wg-hint">0 = no limit</span></label><input type="number" id="wg-msgcap" value="'+(cfg.dailyMsgCap||0)+'" min="0" max="100000"></div>'+
        '<div><label class="lbl">Max spend per day (USD) <span class="wg-hint">0 = no limit</span></label><input type="number" id="wg-spendcap" value="'+(cfg.dailySpendCapUSD||0)+'" min="0" max="1000" step="0.5"></div>'+
        '<div><label class="lbl">Max reply length (tokens)</label><input type="number" id="wg-maxout" value="'+(cfg.maxOut||1024)+'" min="128" max="4000" step="128"></div>'+
      '</div>'+
      '<div class="wg-capwarn" id="wg-capwarn" role="status" aria-live="polite"></div>'+
    '</div>'+
    '<div class="ss2"><div style="display:flex;align-items:center;justify-content:space-between">'+
        '<div><div style="font-size:var(--t-base);font-weight:600">Widget enabled</div><div style="font-size:var(--t-xs);color:var(--mu)">Turn the widget on or off across all your sites instantly.</div></div>'+
        '<label class="sw"><input type="checkbox" id="wg-enabled" '+(cfg.enabled?'checked':'')+'><span class="sw-sl"></span></label>'+
      '</div></div>'+
    '<div style="display:flex;gap:8px"><button class="btn bp" id="wg-save" style="font-size:var(--t-base)">Save changes</button><span id="wg-saved" style="font-size:var(--t-sm);color:var(--green);align-self:center"></span></div>';

  /* What the current settings actually expose, recomputed as they are typed
     rather than discovered on a bill. An uncapped widget on an unrestricted
     origin list is the combination that costs real money: anybody who reads the
     site key out of the page can embed it on their own site and spend against
     the owner's account until the platform-wide ceiling stops it. */
  const capWarn=()=>{
    const el=$('wg-capwarn'); if(!el) return;
    const msgs=parseInt(($('wg-msgcap')||{}).value||'0',10);
    const spend=parseFloat(($('wg-spendcap')||{}).value||'0');
    const origins=(($('wg-origins')||{}).value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const open=[];
    if(!(msgs>0)) open.push('no daily message limit');
    if(!(spend>0)) open.push('no daily spend limit');
    if(!open.length){ el.className='wg-capwarn'; el.textContent=''; return; }
    el.className='wg-capwarn on';
    el.textContent='This widget has '+open.join(' and ')+'. '+
      (origins.length
        ? 'It is locked to your own domains, so only your sites can spend against it - but a busy day still has no ceiling.'
        : 'It is also not locked to any domain, so anybody who reads the site key out of your page can embed it on their own site and spend against your account.')+
      ' Only the platform-wide daily cap would stop it.';
  };
  ['wg-msgcap','wg-spendcap','wg-origins'].forEach(id=>on($(id),'input',capWarn));
  capWarn();

  on($('wg-copy'),'click',()=>{
    const s=_widgetSnippet(_WIDGET_CFG, base);
    try{ navigator.clipboard.writeText(s); toast('Embed code copied','success'); }
    catch(e){ const ta=document.createElement('textarea'); ta.value=s; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy'); toast('Embed code copied','success');}catch(_){ toast('Copy failed - select the code manually','error'); } ta.remove(); }
  });
  on($('wg-preview'),'click',()=>{
    const appOrigin=location.origin;
    window.open(appOrigin+'/#embed=1&k='+encodeURIComponent(_WIDGET_CFG.key),'amv_widget_preview','width=420,height=640');
  });
  on($('wg-save'),'click',async()=>{
    const origins=($('wg-origins').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const payload={
      title:$('wg-title').value, greeting:$('wg-greeting').value, accent:$('wg-accent').value,
      model:$('wg-model').value, systemPrompt:$('wg-sys').value, origins,
      dailyMsgCap:parseInt($('wg-msgcap').value||'0',10),
      dailySpendCapUSD:parseFloat($('wg-spendcap').value||'0'),
      maxOut:parseInt($('wg-maxout').value||'1024',10),
      enabled:$('wg-enabled').checked
    };
    const btn=$('wg-save'); btn.disabled=true; btn.textContent='Saving\u2026';
    try{
      const r=await AMV_API._fetch('/v1/widget/save',{method:'POST',body:JSON.stringify(payload)});
      const d=await r.json();
      if(d&&d.config){ _WIDGET_CFG=d.config; const s=$('wg-saved'); if(s){ s.textContent='Saved \u2713'; setTimeout(()=>{s.textContent='';},2500); } toast('Widget updated','success'); }
      else toast(d&&d.error?d.error:'Save failed','error');
    }catch(e){ toast('Save failed - check your connection','error'); }
    btn.disabled=false; btn.textContent='Save changes';
  });
}
try{ window._paintWidgetForm = _paintWidgetForm; window._widgetSnippet = _widgetSnippet; }catch(e){}
