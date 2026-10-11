/* The marketplace's sell form - fetched the first time somebody opens Sell
   (_mktSellOpen in 07-workspace-memory.js), the way the owner console and the
   spreadsheet editor are. A classic script, so it lands on window and uses the
   page's own helpers: _mktDeliverableOK, _mktScreen, _mktBlockedDialog,
   _mktVerifiedFor, _fileIcon, _fmtBytes and AMVMarket. */
function _mktSell(body){
  if(!body) return;
  body.innerHTML=
    '<div class="ss2"><h3>List something for sale</h3>'+
      '<p style="font-size:var(--t-sm);color:var(--mu);margin:0 0 12px;line-height:1.6">Sell AMV prompts, crews, integrations, workflows, guides - or attach any files (PDFs, videos, models, datasets, images). Set any price (or free). You keep <b style="color:var(--tx)">80%</b> of every sale; it lands in your balance to withdraw. AMV-only - listings can\u2019t reference other AI products.</p>'+
      '<div class="mkt-rules"><div class="mkt-rules-h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>Marketplace Terms - every listing is screened before it goes live'+
        '<button class="mkt-rules-toggle" id="mkt-rules-toggle">Read the full terms</button></div>'+
        '<div class="mkt-rules-body" id="mkt-rules-body" style="display:none">'+
          MKT_POLICY_SECTIONS.map(sec=>'<div class="mkt-rules-sec"><div class="mkt-rules-sh">'+escH(sec.h)+'</div>'+
            '<ul class="mkt-rules-list">'+sec.items.map(r=>'<li>'+escH(r)+'</li>').join('')+'</ul></div>').join('')+
        '</div>'+
        '<div class="mkt-rules-foot">Prohibited content is blocked automatically and never goes live. Three violations suspend your selling access.</div>'+
      '</div>'+
      '<div class="sf" style="max-width:600px;display:flex;flex-direction:column;gap:10px">'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<div style="flex:1;min-width:160px"><label class="lbl">Title</label><input id="sl-title" placeholder="e.g. Excel Finance Pack for AMV" autocomplete="off"></div>'+
          '<div><label class="lbl">Type</label><select id="sl-kind" class="sel"><option value="prompt">Prompt</option><option value="crew">Crew</option><option value="integration">Integration</option><option value="workflow">Workflow</option><option value="guide">Guide</option><option value="agent">Assistant</option><option value="bundle">File bundle</option></select></div>'+
          /* Whole dollars, said on the field. The server rounds - Math.round on
             the price it is given - so a seller who typed 19.99 got a $20
             listing and was told nothing about it. Either the field says what
             it accepts or the price somebody sets is not the price they get,
             and the second one is how a seller finds out from a sale. */
          '<div style="width:130px"><label class="lbl">Price (USD)</label>'+
            '<input id="sl-price" type="number" min="0" max="999" step="1" value="0" inputmode="numeric" aria-describedby="sl-price-h">'+
            '<div id="sl-price-h" class="sl-hint">Whole dollars. 0 is free.</div>'+
          '</div>'+
        '</div>'+
        '<div><label class="lbl">Category</label><input id="sl-cat" placeholder="e.g. Finance"></div>'+
        '<div><label class="lbl">Short description</label><input id="sl-desc" placeholder="What does the buyer get?"></div>'+
        '<div><label class="lbl">The deliverable <span style="color:var(--mu);font-weight:400">(text, instructions, links - optional if you attach files)</span></label><textarea id="sl-text" rows="5" placeholder="Paste the content buyers get: a prompt, instructions, a link to a video, anything\u2026" style="font-family:var(--mn,ui-monospace,monospace);font-size:var(--t-base)"></textarea></div>'+
        '<div><label class="lbl">Attach files <span style="color:var(--mu);font-weight:400">(PDF, video, models, images, any file - delivered on purchase)</span></label>'+
          '<div id="sl-drop" class="sl-drop"><input type="file" id="sl-files" multiple style="display:none"><span>\uD83D\uDCCE Click to add files, or drag them here</span></div>'+
          '<div id="sl-filelist" class="sl-filelist"></div>'+
        '</div>'+
        '<button class="btn bp" id="sl-publish" style="align-self:flex-start;font-size:var(--t-sm)">List it</button>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Your listings</h3><div id="sl-summary" class="sl-summary"></div></div>'+
      '<div id="sl-mine" style="margin-top:12px"><div class="fd-loading">Loading\u2026</div></div></div>';

  // rules expand/collapse
  on($('mkt-rules-toggle'),'click',()=>{
    const b=$('mkt-rules-body'), t=$('mkt-rules-toggle');
    if(!b||!t) return;
    const open=b.style.display!=='none';
    b.style.display=open?'none':'block';
    t.textContent=open?'Read the full terms':'Hide terms';
  });

  // ---- file staging ----
  let staged=[];   // {name,type,size,data(dataURL)}
  const MAXF=25*1024*1024;   // 25MB per file (localStorage-friendly cap for demo mode)
  const drawFiles=()=>{
    const el=$('sl-filelist'); if(!el) return;
    el.innerHTML=staged.map((f,i)=>'<div class="sl-file"><span class="sl-file-ic">'+_fileIcon(f.type,f.name)+'</span><span class="sl-file-n">'+escH(f.name)+'</span><span class="sl-file-sz">'+_fmtBytes(f.size)+'</span><button class="sl-file-x" data-fi="'+i+'">\u00d7</button></div>').join('');
    el.querySelectorAll('[data-fi]').forEach(b=>on(b,'click',()=>{ staged.splice(parseInt(b.dataset.fi,10),1); drawFiles(); }));
  };
  const addFiles=(fileList)=>{
    // Global file limit applies to marketplace listings too.
    if(typeof _ctxFileGuard==='function' && !_ctxFileGuard('workspace', fileList&&fileList.length||1)) return;
    const arr=Array.from(fileList||[]);
    let pending=arr.length;
    arr.forEach(file=>{
      if(file.size>MAXF){ toast(file.name+' is over 25MB - host large files elsewhere and paste the link instead.','error',5000); pending--; return; }
      const rd=new FileReader();
      rd.onload=e=>{ staged.push({name:file.name,type:file.type||'application/octet-stream',size:file.size,data:e.target.result}); drawFiles(); };
      rd.readAsDataURL(file);
    });
  };
  const drop=$('sl-drop'), fi=$('sl-files');
  on(drop,'click',()=>fi&&fi.click());
  on(fi,'change',function(){ addFiles(this.files); this.value=''; });
  ['dragover','dragenter'].forEach(ev=>on(drop,ev,e=>{ e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave','drop'].forEach(ev=>on(drop,ev,e=>{ e.preventDefault(); drop.classList.remove('on'); }));
  on(drop,'drop',e=>{ if(e.dataTransfer&&e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  const loadMine=()=>{ AMVMarket.myListings().then(items=>{
    const el=$('sl-mine'); if(!el) return;
    // summary stats
    const sum=$('sl-summary');
    if(sum){
      const totalViews=items.reduce((a,i)=>a+(i.views||0),0);
      const totalSold=items.reduce((a,i)=>a+(i.sales||0),0);
      const active=items.filter(i=>(i.status||'active')==='active').length;
      sum.innerHTML='<span class="sl-stat"><b>'+items.length+'</b> listings</span><span class="sl-stat"><b>'+active+'</b> active</span><span class="sl-stat"><b>'+totalViews+'</b> views</span><span class="sl-stat"><b>'+totalSold+'</b> sold</span>';
    }
    if(!items.length){ el.innerHTML='<div style="color:var(--mu);font-size:var(--t-sm)">No listings yet. Create one above.</div>'; return; }
    el.innerHTML='<div class="sl-list">'+items.map(it=>{
      const st=it.status||'active';
      const badge='<span class="sl-status sl-status-'+st+'">'+st+'</span>';
      const fileCount=(it.files&&it.files.length)?'<span class="sl-mini"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> '+it.files.length+'</span>':'';
      const actions=
        (st!=='active'?'<button class="btn bs sl-act" data-sl-act="active" data-sl-id="'+escH(it.id)+'">Activate</button>':'')+
        (st!=='sold'?'<button class="btn bs sl-act" data-sl-act="sold" data-sl-id="'+escH(it.id)+'">Mark sold</button>':'')+
        (st!=='deactivated'?'<button class="btn bs sl-act" data-sl-act="deactivated" data-sl-id="'+escH(it.id)+'">Deactivate</button>':'')+
        '<button class="btn sl-act sl-del" data-sl-del="'+escH(it.id)+'">Remove</button>';
      return '<div class="sl-row">'+
        '<div class="sl-row-main"><span class="sl-row-ic">'+_safeIcon(it.icon)+'</span>'+
          '<div><div class="sl-row-t">'+escH(it.title)+' '+_mktPriceTag(it)+' '+badge+'</div>'+
            '<div class="sl-row-meta">'+(it.views||0)+' views \u00b7 '+(it.sales||0)+' sold \u00b7 '+escH(it.cat||'Community')+' '+fileCount+'</div></div>'+
        '</div>'+
        '<div class="sl-row-actions">'+actions+'</div>'+
      '</div>';
    }).join('')+'</div>';
    el.querySelectorAll('[data-sl-act]').forEach(b=>on(b,'click',async()=>{
      try{ await AMVMarket.setStatus(b.dataset.slId,b.dataset.slAct); toast('Listing '+(b.dataset.slAct==='active'?'activated':b.dataset.slAct==='sold'?'marked sold':'deactivated'),'success'); loadMine(); }
      catch(e){ toast(e.message||'Could not update','error'); }
    }));
    el.querySelectorAll('[data-sl-del]').forEach(b=>on(b,'click',async()=>{
      if(!await showConfirmAsync('Remove this listing permanently?\n\nIt stops being visible to new buyers. Anybody who already owns it keeps it.')) return;
      try{ await AMVMarket.unlist(b.dataset.slDel); toast('Listing removed','info'); loadMine(); }catch(e){ toast(e.message||'Could not remove','error'); }
    }));
  }).catch(e=>{
    /* "No listings yet. Create one above." to a seller whose listings simply
       could not be fetched invites them to publish a duplicate. */
    const el=$('sl-mine'); if(!el) return;
    const sum=$('sl-summary'); if(sum) sum.innerHTML='';
    el.innerHTML='<div style="color:var(--mu);font-size:var(--t-sm);line-height:1.6">'+
      escH((e&&e.message)||'Could not load your listings.')+
      ' They are still there. <button class="btn bs" id="sl-mine-retry" style="font-size:var(--t-sm);margin-left:6px">Try again</button></div>';
    on($('sl-mine-retry'),'click',loadMine);
  }); };
  loadMine();

  on($('sl-publish'),'click',async()=>{
    const item={
      kind:$('sl-kind')?.value||'prompt',
      title:($('sl-title')?.value||'').trim(),
      cat:($('sl-cat')?.value||'Community').trim(),
      desc:($('sl-desc')?.value||'').trim(),
      text:($('sl-text')?.value||'').trim(),
      price:Math.max(0,Math.min(999,parseInt($('sl-price')?.value||'0',10)||0)),
      files:staged.slice(),
      icon:staged.length&&!$('sl-text')?.value?_fileIcon(staged[0].type,staged[0].name):'\u2728',
    };
    if(!item.title){ toast('A title is required','error'); return; }
    /* A price that is not what they typed gets said, not applied. The field
       takes whole dollars and the server rounds whatever it is sent, so
       "19.99" silently became a different listing price - and a seller finds
       that out from a sale. Refusing costs one correction; changing it
       quietly costs their trust in what the number on the field means. */
    const priceRaw=($('sl-price')?.value||'0').trim();
    if(priceRaw && !/^\d+$/.test(priceRaw)){
      toast('Prices are whole dollars - use '+Math.max(0,Math.min(999,Math.round(parseFloat(priceRaw)||0)))+' rather than '+priceRaw+'.','error',6000);
      $('sl-price')?.focus();
      return;
    }
    if(!item.text && !item.files.length){ toast('Add a deliverable: paste text/links or attach at least one file','error',5000); return; }
    // It must actually work: real, usable content for its kind.
    const deliv=_mktDeliverableOK(item);
    if(!deliv.ok){ _mktBlockedDialog(deliv.reason,'blocked'); return; }
    // Automated content review - mirrors the server-side gate.
    const screen=_mktScreen(item, _mktVerifiedFor());
    if(!screen.ok){ _mktBlockedDialog(screen.reason, screen.action, screen.category); return; }
    if(screen.action==='held_for_review'){ item._review='pending'; }
    const btn=$('sl-publish'); if(btn){btn.disabled=true;btn.textContent='Listing\u2026';}
    try{ await AMVMarket.publish(item); toast(item.price>0?('Listed for $'+item.price+' - you keep 80%'):'Listed for free','success',4500);
      ['sl-title','sl-desc','sl-text'].forEach(id=>{ if($(id)) $(id).value=''; }); if($('sl-price')) $('sl-price').value='0';
      staged=[]; drawFiles(); loadMine();
    }catch(e){ toast(e.message||'Could not list','error',5000); }
    if(btn){btn.disabled=false;btn.textContent='List it';}
  });
}
window._mktSell = _mktSell;
