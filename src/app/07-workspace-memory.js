/* ============================================================
   AMV WORKSPACE - the Cowork engine. Uses the browser File System
   Access API so AMV can read, edit, and CREATE real files in a folder
   the user grants (Chrome/Edge). Falls back to multi-file upload +
   download everywhere else. This is what lets Cowork actually complete
   work on your files instead of just describing it.
   ============================================================ */
/* Confine any file path to the chosen workspace folder. Strips leading slashes,
   drive letters, and every ".." segment so AI-generated or crafted paths can't
   escape the folder the user picked (path-traversal protection). */
function _safePath(path){
  let p=String(path||'').trim().replace(/\\/g,'/');   // normalize windows slashes
  p=p.replace(/^[a-zA-Z]:/,'');                        // drop drive letter
  p=p.replace(/^\/+/,'');                              // drop leading slashes (no absolute)
  const parts=p.split('/').filter(seg=> seg && seg!=='.' && seg!=='..');  // drop . and ..
  return parts.join('/').slice(0, 400);               // cap length
}
try{ window._safePath=_safePath; }catch(e){}

const AMVWorkspace = {
  dirHandle:null,          // FileSystemDirectoryHandle (granted folder)
  files:[],                // [{name,path,handle?,text?,type,size,dirty}]
  supported(){ return typeof window!=='undefined' && 'showDirectoryPicker' in window; },
  secure(){ return typeof window!=='undefined' && window.isSecureContext; },

  // Ask the user to grant a real folder (Chromium). Reads it recursively.
  async connectFolder(){
    if(!this.supported()) throw new Error('nofsapi');
    if(!this.secure()) throw new Error('insecure');
    const dir=await window.showDirectoryPicker({mode:'readwrite'}).catch(e=>{
      if(e&&e.name==='AbortError') throw new Error('cancelled');
      if(e&&e.name==='SecurityError') throw new Error('insecure');
      throw e;
    });
    this.dirHandle=dir; this.files=[];
    await this._readDir(dir,'');
    return this.files;
  },
  async _readDir(dir, prefix, depth){
    depth=depth||0; if(depth>4) return;   // sane recursion cap
    for await (const [name,handle] of dir.entries()){
      if(name.startsWith('.')||name==='node_modules') continue;
      const path=prefix?prefix+'/'+name:name;
      if(handle.kind==='file'){
        const f=await handle.getFile();
        const isText=/\.(txt|md|csv|tsv|json|js|ts|jsx|tsx|html|css|py|java|c|cpp|go|rs|rb|php|sql|sh|xml|yml|yaml|env|log)$/i.test(name)||f.type.startsWith('text');
        this.files.push({ name, path, handle, type:f.type, size:f.size, isText, text:isText&&f.size<500000?await f.text():null, dirty:false });
      } else if(handle.kind==='directory'){
        await this._readDir(handle, path, depth+1);
      }
    }
  },
  // Upload fallback (any browser): stage files in memory.
  async addUploads(fileList){
    for(const file of Array.from(fileList||[])){
      const isText=/\.(txt|md|csv|tsv|json|js|ts|jsx|tsx|html|css|py|java|c|cpp|go|rs|rb|php|sql|sh|xml|yml|yaml)$/i.test(file.name)||file.type.startsWith('text');
      const text=isText&&file.size<500000?await file.text():null;
      this.files.push({ name:file.name, path:file.name, handle:null, type:file.type, size:file.size, isText, text, dirty:false, uploaded:true });
    }
    return this.files;
  },
  // Create or overwrite a file. Writes to disk if we have a folder; else marks for download.
  async writeFile(path, contents){
    path=_safePath(path);
    if(!path) throw new Error('invalid path');
    let f=this.files.find(x=>x.path===path);
    if(this.dirHandle){
      const parts=path.split('/').filter(p=>p && p!=='.' && p!=='..'); const fname=parts.pop();
      let dir=this.dirHandle;
      for(const p of parts){ dir=await dir.getDirectoryHandle(p,{create:true}); }
      const fh=await dir.getFileHandle(fname,{create:true});
      const w=await fh.createWritable(); await w.write(contents); await w.close();
      if(f){ f.text=contents; f.handle=fh; f.dirty=false; f.size=contents.length; }
      else { this.files.push({name:fname,path,handle:fh,type:'text/plain',size:contents.length,isText:true,text:contents,dirty:false}); }
      return {written:true, toDisk:true, path};
    }
    // no folder: keep in memory + flag as a downloadable output
    if(f){ f.text=contents; f.dirty=true; f.size=contents.length; }
    else { this.files.push({name:path.split('/').pop(),path,handle:null,type:'text/plain',size:contents.length,isText:true,text:contents,dirty:true,output:true}); }
    return {written:true, toDisk:false, path};
  },
  async readFile(path){
    const f=this.files.find(x=>x.path===path); if(!f) return null;
    if(f.text!=null) return f.text;
    if(f.handle){ const file=await f.handle.getFile(); return await file.text(); }
    return null;
  },
  // A compact context string of the workspace for the model.
  contextText(maxChars){
    maxChars=maxChars||24000;
    let out='WORKSPACE FILES ('+this.files.length+'):\n';
    for(const f of this.files){ out+='- '+f.path+' ('+_fmtBytes(f.size||0)+(f.isText?'':' [binary]')+')\n'; }
    out+='\nFILE CONTENTS:\n';
    for(const f of this.files){
      if(!f.isText||f.text==null) continue;
      const chunk='\n===== '+f.path+' =====\n'+f.text+'\n';
      if(out.length+chunk.length>maxChars){ out+='\n[...more files omitted for length...]'; break; }
      out+=chunk;
    }
    return out;
  },
  clear(){ this.dirHandle=null; this.files=[]; },
  downloadOutputs(){
    const outs=this.files.filter(f=>f.output||f.dirty);
    outs.forEach(f=>{ try{ const blob=new Blob([f.text||''],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=f.name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }catch(e){} });
    return outs.length;
  },
};
window.AMVWorkspace=AMVWorkspace;

function renderMarketView(){
  const vc=$('vc'); if(!vc) return;
  const tab=S._mktTab||'browse';
  const tabBtn=(id,label)=>'<button class="mkt-tab'+(tab===id?' on':'')+'" data-mkt-tab="'+id+'">'+label+'</button>';
  const unread=AMVMarket.unreadCount();
  const msgBtn='<button class="mkt-msg-btn" id="mkt-open-msgs" title="Your messages"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Messages'+(unread?'<span class="mkt-msg-badge">'+unread+'</span>':'')+'</button>';
  vc.innerHTML='<div class="sv fi"><div class="vi">'+
    '<div class="mkt-head"><div><span class="eyebrow">Community marketplace</span>'+
      '<h2>AMV Marketplace</h2></div>'+msgBtn+'</div>'+
    '<p class="vsub">Buy and sell AMV prompts, crews, integrations, and workflows. Sellers keep 80% of every sale - paid into your in-app balance, withdraw anytime.</p>'+
    '<div class="mkt-tabs">'+tabBtn('browse','Browse')+tabBtn('sell','Sell')+tabBtn('purchases','My purchases')+tabBtn('earnings','Earnings')+'</div>'+
    '<div id="mkt-body"></div>'+
  '</div></div>';
  vc.querySelectorAll('[data-mkt-tab]').forEach(b=>on(b,'click',()=>{ S._mktTab=b.dataset.mktTab; renderMarketView(); }));
  on($('mkt-open-msgs'),'click',()=>_mktMessages());
  const body=$('mkt-body');
  if(tab==='browse') _mktBrowse(body);
  else if(tab==='sell') _mktSell(body);
  else if(tab==='purchases') _mktPurchases(body);
  else if(tab==='earnings') _mktEarnings(body);
}
window.renderMarketView=renderMarketView;

function _mktPriceTag(it){
  if(!it.price||it.price<=0) return '<span class="mkt-free">Free</span>';
  return '<span class="mkt-price">$'+it.price+'</span>';
}
function _mktStars(rating, ratings){
  const r=Math.round((rating||0)*2)/2; let s='';
  for(let i=1;i<=5;i++){ s+='<span class="mkt-star'+(i<=r?' on':(i-0.5===r?' half':''))+'">\u2605</span>'; }
  return '<span class="mkt-stars" title="'+(rating||0).toFixed(1)+' from '+(ratings||0)+' ratings">'+s+'<span class="mkt-stars-n">'+(rating?rating.toFixed(1):'-')+(ratings?' ('+ratings+')':'')+'</span></span>';
}
const _MKT_SORTS={
  'top':'Most popular', 'rated':'Best rated', 'sales':'Top sellers',
  'price_hi':'Price: high \u2192 low', 'price_lo':'Price: low \u2192 high', 'new':'Newest',
};
function _mktSortFn(key){
  switch(key){
    case 'rated': return (a,b)=>(b.rating||0)-(a.rating||0) || (b.ratings||0)-(a.ratings||0);
    case 'sales': return (a,b)=>(b.sales||0)-(a.sales||0);
    case 'price_hi': return (a,b)=>(b.price||0)-(a.price||0);
    case 'price_lo': return (a,b)=>(a.price||0)-(b.price||0);
    case 'new': return (a,b)=>(b.createdAt||0)-(a.createdAt||0);
    default: return (a,b)=>((b.sales||0)+(b.installs||0))-((a.sales||0)+(a.installs||0));
  }
}
function _mktBrowse(body){
  if(!body) return;
  body.innerHTML=
    '<div id="mkt-top"></div>'+
    '<div class="mkt-controls">'+
      '<input type="text" id="mkt-search" placeholder="Search items, categories, or sellers\u2026" class="mkt-search">'+
      '<select id="mkt-sort" class="sel mkt-sortsel" aria-label="Sort listings">'+Object.entries(_MKT_SORTS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select>'+
    '</div>'+
    '<div class="mk-filters" id="mk-filters" style="margin-bottom:14px"></div>'+
    '<div id="mk-grid" class="mk-grid"><div class="fd-loading">Loading marketplace\u2026</div></div>';
  let activeCat='All', sort='top', search='', items=[];
  const drawTop=()=>{
    const el=$('mkt-top'); if(!el) return;
    // top sellers strip: distinct authors ranked by total sales
    const byAuthor={};
    items.forEach(it=>{ const a=it.author||'community'; byAuthor[a]=(byAuthor[a]||0)+(it.sales||0); });
    const top=Object.entries(byAuthor).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if(!top.length){ el.innerHTML=''; return; }
    el.innerHTML='<div class="mkt-sec-h">Top sellers</div><div class="mkt-sellers">'+
      top.map(([a,n],i)=>'<div class="mkt-seller"><div class="mkt-seller-rank">#'+(i+1)+'</div><div class="mkt-seller-av">'+escH(a.slice(0,1).toUpperCase())+'</div><div class="mkt-seller-b"><div class="mkt-seller-n">'+escH(a)+'</div><div class="mkt-seller-s">'+n+' sold</div></div></div>').join('')+
      '</div>';
  };
  const draw=()=>{
    const grid=$('mk-grid'); if(!grid) return;
    let filtered=activeCat==='All'?items.slice():items.filter(i=>i.cat===activeCat);
    if(search){ const q=search.toLowerCase(); filtered=filtered.filter(i=>(i.title||'').toLowerCase().includes(q)||(i.desc||'').toLowerCase().includes(q)||(i.cat||'').toLowerCase().includes(q)||(i.author||'').toLowerCase().includes(q)); }
    filtered.sort(_mktSortFn(sort));
    if(!filtered.length){ grid.innerHTML='<div class="fd-empty">No results. Try a different search or category - or list something yourself in the Sell tab.</div>'; return; }
    grid.innerHTML=filtered.map(it=>{
      const paid=it.price>0, owned=it._owned, mine=it._mine;
      let btn;
      if(mine) btn='<button class="btn bs" disabled style="font-size:11.5px;flex:1;opacity:.7">Your listing</button>';
      else if(owned) btn='<button class="btn bs mk-getowned" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px;flex:1">\u2713 Owned - use it</button>';
      else if(paid) btn='<button class="btn bp mk-buy" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px;flex:1">Buy \u00b7 $'+it.price+'</button>';
      else btn='<button class="btn bp mk-install" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px;flex:1">'+(it._installed?'\u2713 Get again':'Get it free')+'</button>';
      const previewBtn='<button class="btn bs mk-preview" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px">Preview</button>';
      return '<div class="mk-card">'+
        '<div class="mk-card-top"><span class="mk-icon">'+_safeIcon(it.icon)+'</span>'+
          '<span style="display:flex;gap:6px;align-items:center"><span class="mk-kind mk-kind-'+it.kind+'">'+it.kind+'</span>'+_mktPriceTag(it)+'</span></div>'+
        '<div class="mk-title">'+escH(it.title)+'</div>'+
        '<div class="mk-rating-row">'+_mktStars(it.rating,it.ratings)+'</div>'+
        '<div class="mk-desc">'+escH(it.desc||'')+'</div>'+
        '<div class="mk-meta"><span class="mkt-by" data-mk-seller="'+escH(it.authorEmail||'')+'" data-mk-sellername="'+escH(it.author||'')+'">by '+escH(it.author||'community')+'</span>'+
          '<span class="mk-installs">'+(it.sales?(it.sales+' sold'):(it.installs?(it.installs+' installs'):'new'))+'</span></div>'+
        '<div class="mk-card-actions">'+previewBtn+btn+'</div>'+
      '</div>';
    }).join('');
    grid.querySelectorAll('.mk-preview').forEach(b=>on(b,'click',()=>{ const it=items.find(x=>x.id===b.dataset.mkId); if(it) _mktPreview(it, ()=>{ reload(); }); }));
    grid.querySelectorAll('[data-mk-seller]').forEach(s=>on(s,'click',()=>{ _mktSellerProfile(s.dataset.mkSeller||'', s.dataset.mkSellername||''); }));
    grid.querySelectorAll('.mk-buy').forEach(b=>on(b,'click',()=>{ const it=items.find(x=>x.id===b.dataset.mkId); if(it) _mktDoBuy(it, ()=>reload()); }));
    grid.querySelectorAll('.mk-install,.mk-getowned').forEach(b=>on(b,'click',async()=>{
      const it=items.find(x=>x.id===b.dataset.mkId); if(!it) return;
      try{ await AMVMarket.install(it); reload(); _mktAfterInstall(it); }
      catch(e){ toast(e.message||'Could not add','error'); }
    }));
  };
  const drawFilters=()=>{
    const cats=['All',...Array.from(new Set(items.map(i=>i.cat).filter(Boolean)))];
    const fb=$('mk-filters'); if(!fb) return;
    fb.innerHTML=cats.map(c=>'<button class="mk-filter'+(c===activeCat?' on':'')+'" data-mk-cat="'+escH(c)+'">'+escH(c)+'</button>').join('');
    fb.querySelectorAll('[data-mk-cat]').forEach(b=>on(b,'click',()=>{ activeCat=b.dataset.mkCat; drawFilters(); draw(); }));
  };
  /* A failed load used to leave the grid on its loading state forever, which
     reads as "the marketplace is empty" rather than "this did not load". */
  const reload=()=>AMVMarket.list().then(list=>{
      items=list; drawTop(); drawFilters(); draw();
      /* The list resolving is not the same as the catalogue loading. When the
         server call fails, AMVMarket falls back to the listings that ship with
         AMV - which renders a shop that looks whole and is not: everything
         other people published is missing, and nothing here can be bought
         because checkout needs the same server that just refused. */
      const g=$('mk-grid');
      if(g && AMVMarket._remoteFailed){
        g.insertAdjacentHTML('afterbegin',
          '<div class="mk-partial">Showing only the listings built into AMV - the rest of the marketplace '+
          'could not be reached, and nothing can be bought until it is. '+
          '<button class="btn bs" data-dact="_mktGoBrowse" style="font-size:12px">Try again</button></div>');
      }
    })
    .catch(e=>{
      const g=$('mk-grid');
      if(g) g.innerHTML='<div class="adm-empty">Could not load the marketplace. Check your connection, then <button class="btn bs" data-dact="_mktGoBrowse" style="font-size:12px">try again</button>.</div>';
      try{ _logErr('market.list', e); }catch(_){}
    });
  reload();
  on($('mkt-search'),'input',()=>{ search=$('mkt-search').value; draw(); });
  on($('mkt-sort'),'change',()=>{ sort=$('mkt-sort').value; draw(); });
}
/* Buy handler - backend opens external checkout; local mode completes instantly. */
/* Record a payment to the user's own transaction history (subscriptions +
   marketplace). Shown in Billing \u2192 your transactions. Private per user. */
function _txnKey(){ return ((S.user&&S.user.email)||'you@amv.local').toLowerCase(); }
function _loadTxns(){ try{ const m=load('amv_txns')||{}; return m[_txnKey()]||[]; }catch(e){ return []; } }
function _recordTxn(t){ try{ const m=load('amv_txns')||{}; const arr=m[_txnKey()]||[]; arr.unshift(Object.assign({id:'tx'+Date.now().toString(36), ts:Date.now(), status:'paid', method:'card'}, t)); m[_txnKey()]=arr.slice(0,200); store('amv_txns',m); }catch(e){} }
/* Settle the marketplace purchase that is waiting on an external checkout.
   Nothing did this, so a purchase that COMPLETED still read "Pending" in the
   transaction list for ever - a screen about what somebody has been charged,
   permanently wrong about a charge that went through. */
function _settleMarketTxn(status){
  try{
    const m=load('amv_txns')||{}; const arr=m[_txnKey()]||[];
    const t=arr.find(x=>x && x.type==='marketplace' && x.status==='pending');
    if(!t) return false;
    t.status=status||'paid'; t.settledAt=Date.now();
    m[_txnKey()]=arr; store('amv_txns',m);
    return true;
  }catch(e){ return false; }
}
try{ window._settleMarketTxn=_settleMarketTxn; }catch(e){}
window._recordTxn=_recordTxn;

/* A clear payment screen for a paid marketplace item - shows exactly what
   you're buying and the total, instead of dumping you into Billing. */
function _mktPaymentModal(it){
  const r=$('ovr'); if(!r) return;
  const price=it.price||0;
  r.innerHTML='<div class="ov" id="mkpay-bg"><div class="ob mkpay" onclick="event.stopPropagation()" style="max-width:420px">'+
    '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
    '<h2 style="margin-bottom:14px">Complete your purchase</h2>'+
    '<div class="mkpay-item"><span class="mkpay-ic">'+_safeIcon(it.icon)+'</span><div style="flex:1"><div class="mkpay-t">'+escH(it.title)+'</div><div class="mkpay-k">'+escH(it.kind||'prompt')+' \u00b7 by '+escH(it.author||'community')+'</div></div><div class="mkpay-price">$'+price+'</div></div>'+
    '<div class="mkpay-rows"><div class="mkpay-row"><span>Item price</span><span>$'+price+'.00</span></div><div class="mkpay-row total"><span>Total due</span><span>$'+price+'.00</span></div></div>'+
    '<p class="mkpay-note">\ud83d\udd12 Processed securely by Stripe - AMV never sees your card. You get instant access in Purchases the moment payment clears.</p>'+
    '<button class="btn bp" id="mkpay-go" style="width:100%;justify-content:center;margin-top:6px">Add a payment method to continue</button>'+
    '<p class="mkpay-sub">No payment method is connected yet. Add one to finish - you\u2019ll come right back here.</p>'+
  '</div></div>';
  on($('mkpay-bg'),'click',closeOvr);
  on($('mkpay-go'),'click',()=>{ closeOvr(); try{ S.settingsPane='billing'; setTab('settings'); }catch(e){} });
}
window._mktPaymentModal=_mktPaymentModal;

async function _mktDoBuy(it, after){
  try{
    const d=await AMVMarket.buy(it.id);
    if(d.url){ _recordTxn({type:'marketplace', title:it.title, amount:it.price||0, status:'pending'}); _openExternalPay(d.url,null,'market'); return; }
    if(d.owned){ toast('You already own this','info'); }
    else {
      if((it.price||0)>0) _recordTxn({type:'marketplace', title:it.title, amount:it.price||0, status:'paid'});
      toast('Purchased! It\u2019s in your Purchases, ready to use.','success',4500);
      // offer to review the seller now that they've bought from them
      const sellerEmail=(it.authorEmail||'').toLowerCase();
      if(sellerEmail && sellerEmail!==AMVMarket._me()){
        setTimeout(()=>_mktReviewDialog(sellerEmail, it.author||sellerEmail.split('@')[0], ()=>after&&after()), 700);
      }
    }
    after&&after();
  }catch(e){
    if(e && e.code==='needs_payment'){ _mktPaymentModal(it); return; }
    toast(e.message||'Could not complete purchase','error',4500);
  }
}
/* Preview / detail modal - shows the listing, preview text, reviews, and the buy/get action. */
function _mktPreview(it, after){
  const r=$('ovr'); if(!r) return;
  AMVMarket.view(it.id);   // count a view when the listing is opened
  const paid=it.price>0;
  const unlocked=(it._owned || !paid);
  const previewText = it.preview || it.desc || '';
  const lockedNote = paid && !it._owned ? '<div class="mkt-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Full deliverable'+((it.files&&it.files.length)?' + '+it.files.length+' file'+(it.files.length>1?'s':''):'')+' unlock after purchase - below is a preview.</div>' : '';
  let fullText='';
  if(unlocked){
    if(it.text) fullText+='<div class="mkt-deliverable"><div class="mkt-sec-h">What you get</div><pre class="mkt-pre">'+escH(it.text)+'</pre></div>';
    if(it.crew) fullText+='<div class="mkt-deliverable"><div class="mkt-sec-h">Crew agents</div>'+it.crew.map(a=>'<div class="mkt-crew-row"><b>'+escH(a.role)+'</b> - '+escH(a.task)+'</div>').join('')+'</div>';
    if(it.files&&it.files.length){
      fullText+='<div class="mkt-deliverable"><div class="mkt-sec-h">Files ('+it.files.length+')</div>'+
        it.files.map((f,i)=>'<div class="mkt-file"><span class="sl-file-ic">'+_fileIcon(f.type,f.name)+'</span><span class="sl-file-n">'+escH(f.name)+'</span><span class="sl-file-sz">'+_fmtBytes(f.size||0)+'</span><button class="btn bs mkt-dl" data-dl="'+i+'">\u2193 Download</button></div>').join('')+
      '</div>';
    }
  } else if(paid && it.files && it.files.length){
    // show file names (not content) as a teaser for paid listings
    fullText+='<div class="mkt-deliverable"><div class="mkt-sec-h">Includes '+it.files.length+' file'+(it.files.length>1?'s':'')+'</div>'+
      it.files.map(f=>'<div class="mkt-file mkt-file-locked"><span class="sl-file-ic">'+_fileIcon(f.type,f.name)+'</span><span class="sl-file-n">'+escH(f.name)+'</span><span class="sl-file-sz">'+_fmtBytes(f.size||0)+'</span><span class="mkt-file-lock">\uD83D\uDD12</span></div>').join('')+
    '</div>';
  }
  let actionBtn;
  if(it._mine) actionBtn='<button class="btn bd2" id="mkt-pv-remove">Remove listing</button>';
  else if(it._owned) actionBtn='<button class="btn bp" id="mkt-pv-use">\u2713 Owned - add to library</button>';
  else if(it.status==='sold') actionBtn='<button class="btn bp" id="mkt-pv-msg">\uD83D\uDCAC Message seller</button><button class="btn bs" disabled style="opacity:.6">Sold</button>';
  else if(paid) actionBtn='<button class="btn bp" id="mkt-pv-buy">Buy \u00b7 $'+it.price+'</button>';
  else actionBtn='<button class="btn bp" id="mkt-pv-get">Get it free</button>';
  const rateRow = it._owned && !it._mine ? '<div class="mkt-rate"><span class="mkt-sec-h" style="margin:0">Your rating</span><span class="mkt-rate-stars" id="mkt-pv-rate">'+[1,2,3,4,5].map(n=>'<span class="mkt-rate-star'+(n<=(it._myRating||0)?' on':'')+'" data-stars="'+n+'">\u2605</span>').join('')+'</span></div>' : '';
  r.innerHTML='<div class="ov" id="mkt-pv-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:560px">'+
    '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
    '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:6px">'+
      '<div class="mkt-pv-ic">'+_safeIcon(it.icon)+'</div>'+
      '<div style="flex:1"><h2 style="margin:0 0 2px">'+escH(it.title)+'</h2>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mk-kind mk-kind-'+it.kind+'">'+it.kind+'</span>'+_mktPriceTag(it)+_mktStars(it.rating,it.ratings)+'</div></div>'+
    '</div>'+
    '<p style="font-size:12.5px;color:var(--mu);margin:8px 0">by <span class="mkt-by" data-mk-seller="'+escH(it.authorEmail||'')+'" data-mk-sellername="'+escH(it.author||'')+'">'+escH(it.author||'community')+'</span> \u00b7 '+(it.sales?it.sales+' sold':(it.installs||0)+' installs')+' \u00b7 '+escH(it.cat||'')+'</p>'+
    '<div class="mkt-pv-desc">'+escH(previewText)+'</div>'+
    (it.status==='sold'?'<div class="mkt-sold-banner">\uD83D\uDD34 This item has sold. Message the seller to ask if they can make another.</div>':'')+
    lockedNote+ fullText + rateRow +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'+
      '<button class="btn bs" onclick="closeOvr()">Close</button>'+actionBtn+'</div>'+
    '<div id="mkt-similar"></div>'+
  '</div></div>';
  on($('mkt-pv-bg'),'click',closeOvr);
  document.querySelectorAll('#ovr [data-mk-seller]').forEach(s=>on(s,'click',()=>{ _mktSellerProfile(s.dataset.mkSeller||'', s.dataset.mkSellername||''); }));
  document.querySelectorAll('#ovr .mkt-dl').forEach(b=>on(b,'click',()=>{ const f=it.files[parseInt(b.dataset.dl,10)]; if(f) _downloadFile(f); }));
  // similar items (same category + close price) - scroll-down section like Depop
  AMVMarket.similar(it).then(sims=>{
    const el=$('mkt-similar'); if(!el||!sims.length) return;
    el.innerHTML='<div class="mkt-sec-h" style="margin-top:20px">Similar items</div>'+
      '<div class="mkt-sim-grid">'+sims.map(s=>'<div class="mkt-sim" data-sim="'+escH(s.id)+'">'+
        '<div class="mkt-sim-ic">'+_safeIcon(s.icon)+'</div>'+
        '<div class="mkt-sim-b"><div class="mkt-sim-t">'+escH(s.title)+'</div>'+
          '<div class="mkt-sim-m">'+_mktPriceTag(s)+' <span class="mkt-sim-by">'+escH(s.author||'community')+'</span></div></div>'+
      '</div>').join('')+'</div>';
    el.querySelectorAll('[data-sim]').forEach(c=>on(c,'click',()=>{ const s=sims.find(x=>x.id===c.dataset.sim); if(s){ closeOvr(); setTimeout(()=>_mktPreview(s,after),120); } }));
  });
  on($('mkt-pv-buy'),'click',async()=>{ await _mktDoBuy(it,()=>{ closeOvr(); after&&after(); }); });
  on($('mkt-pv-msg'),'click',()=>{ closeOvr(); _mktChat(it.authorEmail, it.author, 'Hi! I saw "'+it.title+'" just sold - could you make another?'); });
  on($('mkt-pv-get'),'click',async()=>{ try{ await AMVMarket.install(it); after&&after(); _mktAfterInstall(it); }catch(e){ toast(e.message||'Could not add','error'); } });
  on($('mkt-pv-use'),'click',async()=>{ try{ await AMVMarket.install(it); _mktAfterInstall(it); }catch(e){ toast('Could not add','error'); } });
  on($('mkt-pv-remove'),'click',async()=>{
    if(!confirm('Remove this listing from the marketplace? Buyers who already own it keep it.')) return;
    try{ await AMVMarket.unlist(it.id); toast('Listing removed','info'); closeOvr(); if(S.tab==='market'){ try{ renderMarketView(); }catch(e){} } }
    catch(e){ toast(e.message||'Could not remove','error'); }
  });
  const rate=$('mkt-pv-rate');
  if(rate) rate.querySelectorAll('[data-stars]').forEach(s=>on(s,'click',async()=>{
    const stars=parseInt(s.dataset.stars,10); await AMVMarket.rate(it.id,stars);
    rate.querySelectorAll('[data-stars]').forEach(x=>x.classList.toggle('on',parseInt(x.dataset.stars,10)<=stars));
    toast('Thanks for rating!','success'); after&&after();
  }));
}
window._mktPreview=_mktPreview;

/* Seller profile - avatar, average rating, all reviews, and their listings.
   Opened by clicking a seller's name anywhere in the marketplace. */
async function _mktSellerProfile(sellerEmail, sellerName){
  sellerEmail=(sellerEmail||'').toLowerCase();
  const r=$('ovr'); if(!r) return;
  // Official first-party AMV listings have no seller email. Show an official
  // profile whose "Message" routes to support, not the peer-to-peer seller chat.
  const isOfficial = !sellerEmail;
  if(isOfficial){
    const all=await AMVMarket.list();
    const theirs=all.filter(it=>!(it.authorEmail||'') && /^amv$/i.test(it.author||''));
    const listingRows = theirs.length
      ? theirs.map(it=>'<div class="vrow mkt-listing-row" data-mk-open="'+escH(it.id)+'" style="cursor:pointer"><span>'+_safeIcon(it.icon)+' '+escH(it.title)+' '+_mktPriceTag(it)+'</span><span class="mkt-row-meta"><span class="mkt-st active">Active</span><span style="color:var(--mu);font-size:11px">'+(it.sales||it.installs||0)+(it.sales?' sold':' installs')+'</span><span class="mkt-row-arr">\u203a</span></span></div>').join('')
      : '<div style="color:var(--mu);font-size:12.5px">No active listings.</div>';
    r.innerHTML='<div class="ov" id="mkt-sp-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:560px">'+
      '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
      '<div class="mkt-sp-head">'+_avatarHTML('amv',64)+
        '<div style="flex:1"><h2 style="margin:0 0 3px">AMV <span style="font-size:12px;color:var(--accent);vertical-align:middle">\u2713 Official</span></h2>'+
          '<div style="font-size:12.5px;color:var(--mu)">First-party tools, prompts and crews built by the AMV team.</div>'+
          '<div style="font-size:12px;color:var(--mu);margin-top:4px">'+theirs.length+' official listing'+(theirs.length===1?'':'s')+'</div>'+
          '<button class="btn bp" id="mkt-sp-msg" style="font-size:12px;margin-top:10px">\uD83D\uDCAC Contact AMV support</button>'+
        '</div></div>'+
      '<div class="ss2"><h3>Official listings</h3><div class="vbreak">'+listingRows+'</div></div>'+
    '</div></div>';
    on($('mkt-sp-bg'),'click',closeOvr);
    on($('mkt-sp-msg'),'click',()=>{ closeOvr(); try{ setTab('help'); }catch(e){ toast('Reach the AMV team from the Help Center.','info'); } });
    document.querySelectorAll('#mkt-sp-bg [data-mk-open]').forEach(el=>on(el,'click',()=>{ const it=theirs.find(x=>x.id===el.dataset.mkOpen); if(it) _mktPreview(it, ()=>{}); }));
    return;
  }
  // Build the seller's FULL catalog - including SOLD items - so their profile
  // shows everything (active and sold), even though sold items leave public browse.
  const pub=await AMVMarket.list();
  const seen={}, merged=[];
  for(const it of [...pub, ...AMVMarket._localListings()]){ if(seen[it.id]) continue; seen[it.id]=1; merged.push(it); }
  const theirs=merged.filter(it=>(it.authorEmail||'').toLowerCase()===sellerEmail)
    .sort((a,b)=>(a.status==='sold'?1:0)-(b.status==='sold'?1:0));   // active first, sold last
  const name=sellerName||(theirs[0]&&theirs[0].author)||sellerEmail.split('@')[0]||'Seller';
  const rating=AMVMarket.sellerRating(sellerEmail);
  const reviews=AMVMarket.sellerReviews(sellerEmail);
  const totalSold=theirs.reduce((a,it)=>a+(it.sales||0),0);
  const isMe=sellerEmail===AMVMarket._me();
  const bought=await AMVMarket.boughtFrom(sellerEmail);
  const mine=AMVMarket.myReviewFor(sellerEmail);

  const reviewList = reviews.length
    ? reviews.map(rv=>'<div class="mkt-review">'+
        '<div class="mkt-review-h">'+_avatarHTML(rv.by,28)+'<div><div class="mkt-review-by">'+escH(rv.byName||rv.by.split('@')[0])+'</div>'+
          '<div class="mkt-stars">'+[1,2,3,4,5].map(n=>'<span class="mkt-star'+(n<=rv.stars?' on':'')+'">\u2605</span>').join('')+'</div></div>'+
          '<span class="mkt-review-when">'+new Date(rv.ts).toLocaleDateString()+'</span></div>'+
        (rv.text?'<div class="mkt-review-text">'+escH(rv.text)+'</div>':'')+
      '</div>').join('')
    : '<div style="color:var(--mu);font-size:12.5px;padding:6px 0">No reviews yet.</div>';

  const listingRows = theirs.length
    ? theirs.map(it=>'<div class="vrow mkt-listing-row" data-mk-open="'+escH(it.id)+'" style="cursor:pointer"><span>'+_safeIcon(it.icon)+' '+escH(it.title)+' '+_mktPriceTag(it)+'</span><span class="mkt-row-meta"><span class="mkt-st '+(it.status==='sold'?'sold':'active')+'">'+(it.status==='sold'?'Sold':'Active')+'</span><span style="color:var(--mu);font-size:11px">'+(it.sales||0)+' sold</span><span class="mkt-row-arr">\u203a</span></span></div>').join('')
    : '<div style="color:var(--mu);font-size:12.5px">No active listings.</div>';

  let reviewBtn='';
  if(isMe) reviewBtn='<span style="font-size:12px;color:var(--mu)">This is you</span>';
  else if(bought) reviewBtn='<button class="btn bp" id="mkt-write-review" style="font-size:12px">'+(mine?'Edit your review':'Write a review')+'</button>';
  else reviewBtn='<span style="font-size:12px;color:var(--mu)">Buy from this seller to leave a review</span>';

  r.innerHTML='<div class="ov" id="mkt-sp-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:560px">'+
    '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
    '<div class="mkt-sp-head">'+_avatarHTML(sellerEmail,64)+
      '<div style="flex:1"><h2 style="margin:0 0 3px">'+escH(name)+'</h2>'+
        '<div class="mkt-sp-stats">'+
          (rating.count?('<span class="mkt-stars">'+[1,2,3,4,5].map(n=>'<span class="mkt-star'+(n<=Math.round(rating.avg)?' on':'')+'">\u2605</span>').join('')+'<span class="mkt-stars-n">'+rating.avg+' ('+rating.count+' review'+(rating.count===1?'':'s')+')</span></span>'):'<span style="color:var(--mu);font-size:12px">No ratings yet</span>')+
        '</div>'+
        '<div style="font-size:12px;color:var(--mu);margin-top:4px">'+theirs.length+' listing'+(theirs.length===1?'':'s')+' \u00b7 '+totalSold+' sold</div>'+
        (isMe?'':'<button class="btn bp" id="mkt-sp-msg" style="font-size:12px;margin-top:10px">\uD83D\uDCAC Message seller</button>')+
      '</div></div>'+
    '<div class="ss2" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Reviews</h3>'+reviewBtn+'</div>'+reviewList+'</div>'+
    '<div class="ss2"><h3>Listings</h3><div class="vbreak">'+listingRows+'</div></div>'+
  '</div></div>';
  on($('mkt-sp-bg'),'click',closeOvr);
  on($('mkt-sp-msg'),'click',()=>{ closeOvr(); _mktChat(sellerEmail, name); });
  on($('mkt-write-review'),'click',()=>_mktReviewDialog(sellerEmail, name, ()=>_mktSellerProfile(sellerEmail,name)));
  document.querySelectorAll('#mkt-sp-bg [data-mk-open]').forEach(el=>on(el,'click',()=>{ const it=theirs.find(x=>x.id===el.dataset.mkOpen); if(it) _mktPreview(it, ()=>_mktSellerProfile(sellerEmail,name)); }));
}
window._mktSellerProfile=_mktSellerProfile;

/* Messages inbox - list of conversations, opens a thread on click. */
function _mktMessages(){
  const r=$('ovr'); if(!r) return;
  const threads=AMVMarket.myThreads();
  const me=AMVMarket._me();
  const rows = threads.length ? threads.map(t=>{
    const other=t.a===me?t.b:t.a;
    const otherName=t.a===me?(t.bName||other.split('@')[0]):(t.aName||other.split('@')[0]);
    const last=t.msgs[t.msgs.length-1];
    const seenCount=(t.read&&typeof t.read[me]==='number')?t.read[me]:0;
    const unread=last&&last.from!==me&&t.msgs.length>seenCount;
    return '<div class="mkt-thread'+(unread?' unread':'')+'" data-th="'+escH(other)+'" data-thn="'+escH(otherName)+'">'+
      _avatarHTML(other,40)+
      '<div class="mkt-thread-b"><div class="mkt-thread-t">'+escH(otherName)+(unread?'<span class="mkt-thread-dot"></span>':'')+'</div>'+
        '<div class="mkt-thread-p">'+(last?(last.from===me?'You: ':'')+escH(last.text.slice(0,60)):'No messages yet')+'</div></div>'+
      '<span class="mkt-thread-when">'+(last?_timeAgo(last.ts):'')+'</span>'+
    '</div>';
  }).join('') : '<div class="fd-empty">No messages yet. Message a seller from their profile to start a conversation.</div>';
  r.innerHTML='<div class="ov" id="mkt-inbox-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:480px">'+
    '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
    '<h2 style="margin-bottom:14px">Your messages</h2>'+
    '<div class="mkt-threads">'+rows+'</div>'+
  '</div></div>';
  on($('mkt-inbox-bg'),'click',closeOvr);
  r.querySelectorAll('[data-th]').forEach(t=>on(t,'click',()=>_mktChat(t.dataset.th, t.dataset.thn)));
}
window._mktMessages=_mktMessages;

/* A single conversation thread with a seller (or buyer). prefill seeds the composer. */
function _mktChat(otherEmail, otherName, prefill){
  otherEmail=(otherEmail||'').toLowerCase();
  if(!otherEmail){ toast('No seller to message','error'); return; }
  const r=$('ovr'); if(!r) return;
  AMVMarket.markThreadRead(otherEmail);
  const me=AMVMarket._me();
  const draw=()=>{
    const t=AMVMarket.thread(otherEmail);
    const name=otherName||(t.a===me?t.bName:t.aName)||otherEmail.split('@')[0];
    const bubbles = t.msgs.length ? t.msgs.map(m=>'<div class="mkt-bubble '+(m.from===me?'me':'them')+'">'+escH(m.text)+'<span class="mkt-bubble-t">'+_timeAgo(m.ts)+'</span></div>').join('') : '<div style="color:var(--mu);font-size:12.5px;text-align:center;padding:20px">Say hello - ask about an item, a custom order, anything.</div>';
    r.innerHTML='<div class="ov" id="mkt-chat-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:460px;display:flex;flex-direction:column;max-height:80vh">'+
      '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
      '<div class="mkt-chat-head">'+_avatarHTML(otherEmail,36)+'<div><div style="font-weight:600;font-size:14px">'+escH(name)+'</div><div style="font-size:11px;color:var(--mu)">'+escH(otherEmail)+'</div></div>'+
        '<button class="btn bs" id="mkt-chat-prof" style="margin-left:auto;font-size:11px">Profile</button></div>'+
      '<div class="mkt-chat-body" id="mkt-chat-body">'+bubbles+'</div>'+
      '<div class="mkt-chat-input"><input type="text" id="mkt-chat-txt" placeholder="Message\u2026" autocomplete="off"'+(prefill?' value="'+escH(prefill)+'"':'')+'><button class="btn bp" id="mkt-chat-send">Send</button></div>'+
    '</div></div>';
    on($('mkt-chat-bg'),'click',closeOvr);
    on($('mkt-chat-prof'),'click',()=>{ closeOvr(); _mktSellerProfile(otherEmail, name); });
    const send=async()=>{ const txt=$('mkt-chat-txt')?.value||''; if(!txt.trim()) return; try{ await AMVMarket.sendMessage(otherEmail, txt, name); prefill=''; draw(); const b=$('mkt-chat-body'); if(b) b.scrollTop=b.scrollHeight; }catch(e){ toast(e.message||'Could not send','error'); } };
    on($('mkt-chat-send'),'click',send);
    on($('mkt-chat-txt'),'keydown',e=>{ if(e.key==='Enter') send(); });
    const b=$('mkt-chat-body'); if(b) b.scrollTop=b.scrollHeight;
    const txt=$('mkt-chat-txt'); if(txt){ txt.focus(); txt.value=txt.value; }
  };
  draw();
}
window._mktChat=_mktChat;

// short relative time
function _timeAgo(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'now'; if(s<3600) return Math.floor(s/60)+'m'; if(s<86400) return Math.floor(s/3600)+'h';
  if(s<604800) return Math.floor(s/86400)+'d'; return new Date(ts).toLocaleDateString();
}
window._timeAgo=_timeAgo;

/* Write/edit a 1-5 star review of a seller. */
function _mktReviewDialog(sellerEmail, sellerName, onDone){
  const r=$('ovr'); if(!r) return;
  const existing=AMVMarket.myReviewFor(sellerEmail);
  let stars=existing?existing.stars:0;
  const drawStars=()=>[1,2,3,4,5].map(n=>'<span class="mkt-rate-star'+(n<=stars?' on':'')+'" data-stars="'+n+'">\u2605</span>').join('');
  r.innerHTML='<div class="ov" id="mkt-rv-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:460px">'+
    '<button class="oc" onclick="closeOvr()">\u00d7</button>'+
    '<h2 style="margin-bottom:4px">Review '+escH(sellerName)+'</h2>'+
    '<p class="ob-sub" style="margin-bottom:14px">Your rating helps other buyers. You can only review sellers you\u2019ve bought from.</p>'+
    '<div class="mkt-rate" style="margin:0 0 14px"><span class="mkt-rate-stars" id="mkt-rv-stars">'+drawStars()+'</span></div>'+
    '<textarea id="mkt-rv-text" rows="4" placeholder="Share your experience (optional)\u2026" style="width:100%;font-size:13px">'+escH(existing?existing.text:'')+'</textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn bs" onclick="closeOvr()">Cancel</button><button class="btn bp" id="mkt-rv-save">Submit review</button></div>'+
  '</div></div>';
  on($('mkt-rv-bg'),'click',closeOvr);
  const starsEl=$('mkt-rv-stars');
  const rebind=()=>{ starsEl.innerHTML=drawStars(); starsEl.querySelectorAll('[data-stars]').forEach(s=>on(s,'click',()=>{ stars=parseInt(s.dataset.stars,10); rebind(); })); };
  rebind();
  on($('mkt-rv-save'),'click',async()=>{
    if(!stars){ toast('Pick a star rating','error'); return; }
    try{ await AMVMarket.reviewSeller(sellerEmail, stars, $('mkt-rv-text')?.value||''); toast('Review posted - thanks!','success'); closeOvr(); onDone&&onDone(); }
    catch(e){ toast(e.message||'Could not post review','error',4500); }
  });
}
window._mktReviewDialog=_mktReviewDialog;
function _mktPurchases(body){
  if(!body) return;
  body.innerHTML='<div class="fd-loading">Loading your purchases\u2026</div>';
  AMVMarket.purchases().then(items=>{
    if(!items.length){ body.innerHTML=emptyState({icon:'\uD83D\uDED2',title:'No purchases yet',sub:'Things you buy in the marketplace show up here - private to you, ready to use, forever.',btn:{label:'Browse the marketplace',act:'_mktGoBrowse'}}); return; }
    body.innerHTML='<p class="mkt-priv">\uD83D\uDD12 Private - only you can see your purchases.</p><div class="mk-grid">'+items.map(it=>{
      const fc=(it.files&&it.files.length)?'<span class="sl-mini">\uD83D\uDCCE '+it.files.length+' file'+(it.files.length>1?'s':'')+'</span>':'';
      return '<div class="mk-card">'+
        '<div class="mk-card-top"><span class="mk-icon">'+_safeIcon(it.icon)+'</span><span style="display:flex;gap:6px;align-items:center"><span class="mk-kind mk-kind-'+(it.kind||'prompt')+'">'+(it.kind||'prompt')+'</span></span></div>'+
        '<div class="mk-title">'+escH(it.title)+'</div>'+
        '<div class="mk-desc">'+escH(it.desc||'')+'</div>'+
        (it._removed?'<div class="mk-meta" style="color:var(--mu)">Seller removed this listing</div>':
          '<div class="mk-meta"><span></span>'+fc+'</div><div class="mk-card-actions"><button class="btn bs mk-view" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px;flex:1">View / download</button><button class="btn bp mk-use" data-mk-id="'+escH(it.id)+'" style="font-size:11.5px;flex:1">'+(it.kind==='crew'?'Use in Crew':(it.kind==='workflow'||it.kind==='integration')?'Use it':'Try in chat')+'</button></div>')+
      '</div>';
    }).join('')+'</div>';
    body.querySelectorAll('.mk-use').forEach(b=>on(b,'click',()=>{
      const it=items.find(x=>x.id===b.dataset.mkId); if(!it) return;
      _mktUsePurchase(it);
    }));
    body.querySelectorAll('.mk-view').forEach(b=>on(b,'click',()=>{ const it=items.find(x=>x.id===b.dataset.mkId); if(it){ it._owned=true; _mktPreview(it); } }));
  }).catch(e=>{
    /* "No purchases yet" for somebody who has paid for things is the worst
       available answer, so a failed read says it failed. */
    body.innerHTML='<div class="ss2"><h3>Could not load your purchases</h3>'+
      '<p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0 0 12px">'+
      escH((e&&e.message)||'AMV could not reach the server.')+
      ' Everything you have bought is still yours.</p>'+
      '<button class="btn bs" id="mkt-pur-retry" style="font-size:12px">Try again</button></div>';
    on($('mkt-pur-retry'),'click',()=>_mktPurchases(body));
  });
}
/* After adding a marketplace item to the user's library, take them straight
   to where it now lives so "added to library" is never a mystery. */
/* Swap a seller's own email for the buyer's inside a bought template, so it
   works as your own the moment you use it. */
function _mktPersonalize(text, sellerEmail, myEmail){
  let t=String(text||'');
  if(sellerEmail && myEmail){ try{ t=t.split(sellerEmail).join(myEmail); }catch(e){} }
  return t;
}
window._mktPersonalize=_mktPersonalize;
/* Use a purchased item. Routes to the actual page and makes it usable there:
   crews open in Crew (under "From the marketplace"); prompts paste straight
   into chat; workflows/integrations install and open where they live. */
/* Which tool a purchased item belongs to (so it lands where it actually works). */
function _mktHome(it){
  if(it.kind==='crew'||it.kind==='workflow') return 'crew';
  const t=((it.cat||'')+' '+(it.title||'')+' '+(it.kind||'')+' '+(it.desc||'')).toLowerCase();
  if(/design|image|art|logo|brand|poster|\bui\b|graphic|thumbnail|creative|flyer|banner|mockup/.test(t)) return 'studio';
  if(/\bcode\b|\bapp\b|script|\bdev\b|\bapi\b|component|website|html|css|python|javascript|react|\bsql\b|backend|frontend/.test(t)) return 'dev';
  return 'chat';
}
function _mktUsePurchase(it){
  if(!it) return;
  const me=(S.user&&S.user.email)||'';
  try{ closeOvr&&closeOvr(); }catch(e){}
  const text=_mktPersonalize(it.text||it.preview||it.desc||it.title||'', it.authorEmail, me);
  const home=_mktHome(it);
  // crew / workflow → install and run in Crew (real agents from the listing)
  if(home==='crew'){
    try{ AMVMarket.install(it); }catch(e){}
    toast('Added to Crew - see “Marketplace plugins” at the bottom of this page.','success',4500);
    setTab('crew');
    setTimeout(()=>{ const el=document.getElementById('mc-bought'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }, 700);
    return;
  }
  try{ AMVMarket.install(it); }catch(e){}
  if(home==='studio'){ setTab('studio'); setTimeout(()=>{ const ta=$('dsn-prompt'); if(ta){ ta.value=text; ta.dispatchEvent(new Event('input')); ta.focus(); } },280); toast('Loaded into Studio - tweak it and generate.','success',3800); return; }
  if(home==='dev'){ setTab('dev'); setTimeout(()=>{ const ta=$('dev-msg'); if(ta){ ta.value=text; ta.dispatchEvent(new Event('input')); ta.focus(); } },280); toast('Loaded into Dev - tweak it and build.','success',3800); return; }
  // prompt / guide / anything text-based → chat + auto-paste (personalized)
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value=text; ta.dispatchEvent(new Event('input')); ta.focus(); try{ ta.setSelectionRange(ta.value.length, ta.value.length); }catch(e){} } }, 240);
  toast('Pasted into chat - tweak it and send.','success',3800);
}
window._mktUsePurchase=_mktUsePurchase;
window._mktHome=_mktHome;

/* Owned marketplace items (hydrated), read locally. Used to render the
   "Marketplace plugins" section at the bottom of the relevant tool page. */
function _ownedMarketItems(){
  try{
    const purch=AMVMarket._localPurchases();
    const all=[...AMVMarket._localListings(), ...MARKET_STARTER];
    return purch.map(p=>{ const it=all.find(x=>x.id===p.id); return it?{...it,_purchasedAt:p.ts}:null; }).filter(Boolean);
  }catch(e){ return []; }
}
function _ownedForPage(page){ return _ownedMarketItems().filter(it=>_mktHome(it)===page); }
/* Renders the owned-items block for a tool page (empty string if none owned),
   so it only appears when the user actually owns something usable there. */
function _ownedMarketHTML(page){
  const items=_ownedForPage(page); if(!items.length) return '';
  const label={studio:'Use in Studio',dev:'Open in Dev',chat:'Try in chat'}[page]||'Use it';
  return `<div class="mc-sec mc-bought owned-plugins" id="owned-${page}">
    <div class="sec-head"><h3>Marketplace plugins</h3><span class="sec-sub">Things you bought that work here. Open one to use it - your details are filled in for you.</span></div>
    <div class="mc-grid">${items.slice(0,8).map(it=>`<div class="mc-card">
      <div class="mc-card-top"><span class="mc-card-t">${escH(it.title||'Item')}</span><span class="mc-pill ok">Owned</span></div>
      <div class="mc-card-sub">${escH((it.desc||it.cat||'').slice(0,120))}${it.author?` · by ${escH(it.author)}`:''}</div>
      <div class="mc-card-act"><button class="btn mc-mini" data-dact="_ownedUse" data-darg="${escH(it.id)}">${label}</button></div>
    </div>`).join('')}</div>
  </div>`;
}
function _ownedUse(id){ const it=_ownedMarketItems().find(x=>x.id===id); if(!it){ toast('Item not found','error'); return; } _mktUsePurchase(it); }
window._ownedMarketHTML=_ownedMarketHTML; window._ownedUse=_ownedUse;
function _mktAfterInstall(it){
  // Everything you get lands in Purchases - the one place your items live.
  try{ closeOvr(); }catch(e){}
  toast('Added to your purchases - open it there to use it.','success',3800);
  setTimeout(()=>{ try{ S._mktTab='purchases'; setTab('market'); if(S.tab==='market') renderMarketView(); }catch(e){} }, 550);
}
window._mktAfterInstall=_mktAfterInstall;
function _mktGoBrowse(){ S._mktTab='browse'; renderMarketView(); }
window._mktGoBrowse=_mktGoBrowse;
/* ── MARKETPLACE TRUST & SAFETY (client mirror) ───────────────
   The authoritative screening runs server-side on /v1/market/publish and can't
   be bypassed. This client copy gives sellers instant feedback before submit. */

// Full Acceptable Use Policy, grouped like a real marketplace publishes it.
const MKT_POLICY_SECTIONS = [
  { h:'Prohibited - never allowed', items:[
    'Illegal drugs, controlled substances, or prescription medication without authorization.',
    'Weapons, firearms, ammunition, explosives, or instructions for making them.',
    'Malware, ransomware, exploits, phishing kits, or any tool designed to attack systems.',
    'Stolen data, hacked accounts, credit-card dumps, credentials, or personal data you don\u2019t own.',
    'Fraud, scams, counterfeits, money laundering, or "get rich quick" schemes.',
    'Sexual content, and absolutely nothing involving minors.',
    'Content promoting violence, terrorism, trafficking, or self-harm.',
    'Hate speech, harassment, or content targeting people by identity.',
    'Pirated, cracked, or stolen material - you must own or license what you sell.',
  ]},
  { h:'Restricted - verified sellers only', items:[
    'Financial, investment, or trading advice.',
    'Medical, health, or treatment claims.',
    'Legal advice or representation.',
    'Adult (18+) material, where lawful.',
  ]},
  { h:'Your obligations as a seller', items:[
    'Describe honestly - buyers must receive exactly what you advertised.',
    'You own the rights to everything you list, or have a licence to resell it.',
    'No impersonating other people, brands, or AMV staff.',
    'Listings are AMV-only and can\u2019t reference or require other AI products.',
    'Respond to buyers and honour refunds where the deliverable was misrepresented.',
    'Keep your listing current - remove it if it stops working.',
  ]},
  { h:'How enforcement works', items:[
    'Every listing is screened automatically before it goes live.',
    'Prohibited content is blocked outright and never reaches the catalog.',
    'Higher-risk listings are published but held for review, and removed if they break the rules.',
    'Buyers can report any listing; reports are reviewed by our team.',
    'Three violations suspend your selling access. Serious violations suspend it immediately.',
  ]},
];
// Flat list for compact displays.
const MKT_POLICY = MKT_POLICY_SECTIONS.flatMap(s=>s.items);

// Normalizer mirrors the server: defeats leetspeak / spacing / accent evasion.
function _mktNorm(str){
  let t=String(str||'').toLowerCase();
  t=t.replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e\u061c]/g,'');
  const homo={'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','ѕ':'s','і':'i','ј':'j','к':'k','м':'m','н':'h','т':'t','в':'b','г':'r','ԁ':'d','ո':'n','ε':'e','ο':'o','ρ':'p','τ':'t','ν':'v','α':'a','ι':'i','κ':'k','μ':'m'};
  t=t.replace(/[а-яөԁα-ωѕіј]/g,c=>homo[c]||c);
  try{ t=t.normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }catch(e){}
  const leet={'0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','5':'s','$':'s','7':'t','8':'b','9':'g','+':'t','|':'i'};
  t=t.replace(/[01!34@5$789+|]/g,c=>leet[c]||c);
  t=t.replace(/[\s._\-*~`'"()\[\]{}<>\/\\]+/g,' ');
  return { spaced:' '+t.replace(/\s+/g,' ').trim()+' ', squeezed:t.replace(/\s+/g,'') };
}
const _MKT_PROHIBITED={
  'Illegal drugs & controlled substances':['cocaine','heroin','fentanyl','methamphetamine','crystal meth','mdma','ecstasy','lsd','ketamine','pcp','crack cocaine','psilocybin','magic mushrooms','ghb','rohypnol','roofie','oxycontin','oxycodone','xanax','adderall','vicodin','percocet','codeine','lean drug','promethazine','tramadol','valium','klonopin','opioid','opiates','xanax bars','illegal drugs','buy drugs','sell drugs','drug dealer','narcotics for sale','dark web drugs','anabolic steroids','no prescription needed','weed for sale','buy weed','sell weed','marijuana for sale','buy marijuana','cannabis for sale','buy cannabis','thc cart','dab pen','edibles for sale','ounce of weed','gram of weed','8 ball','eightball','molly for sale','buy molly','shrooms for sale','acid tabs','dmt','coke for sale','plug drugs','drug plug','420 friendly bud','top shelf bud','sativa for sale','indica for sale'],
  'Weapons & explosives':['firearm','handgun','rifle for sale','assault weapon','ghost gun','untraceable gun','80 lower','auto sear','glock switch','silencer','suppressor','ammunition','ammo for sale','bump stock','explosive','pipe bomb','bomb making','ied','grenade','detonator','napalm','thermite','weapon blueprint','3d printed gun','gun cad','poison','ricin','nerve agent','sarin','chemical weapon'],
  'Malware, hacking & cyber attack':['malware','ransomware','keylogger','botnet','ddos','rootkit','trojan','spyware','stalkerware','exploit kit','zero day exploit','remote access trojan','rat builder','crypter','stealer','phishing kit','phishing page','fake login page','sql injection tool','brute force tool','password cracker','credential stuffing','account cracker','combo list','sim swap','swatting','doxxing service','hack someone','hacking service','hack account'],
  'Stolen data & credentials':['stolen data','stolen account','hacked account','cracked account','database dump','leaked database','data breach dump','stolen card','stolen credit','credit card numbers','card dump','cvv dump','fullz','bank logs','bank drop','dumps with pin','carding','carder','paypal log','account list','ssn list','social security numbers','stolen identity'],
  'Fraud, scams & counterfeiting':['money launder','launder money','money mule','cash out method','cashout method','fraud method','fraud bible','counterfeit','fake id','forged document','fake passport','fake diploma','replica designer','ponzi','pyramid scheme','guaranteed profit','risk free profit','insider trading','chargeback fraud','refund method','refund glitch','bin method'],
  'Sexual content & exploitation':['child porn','csam','cp for sale','underage','minor sexual','loli','shota','jailbait','bestiality','rape porn','non consensual','revenge porn','upskirt','deepfake nude','nudify','escort service','prostitution','sex trafficking','nude leak'],
  'Violence, terrorism & trafficking':['assassinate','murder for hire','hitman','contract killing','kill someone','how to kill','how to murder','human trafficking','organ sale','sell organ','kidnapping guide','torture','terrorist','terrorism','extremist manifesto','mass shooting','school shooting','genocide'],
  'Hate & harassment':['white supremacy','neo nazi','race war','holocaust denial','hate speech pack','harassment campaign','brigading service'],
  'Piracy & IP theft':['pirated','cracked software','keygen','license key generator','nulled script','warez','stolen course','leaked course','bypass drm','drm removal'],
  'Self-harm':['suicide method','how to kill yourself','best way to die','suicide kit','pro ana','thinspo','self harm guide'],
};
const _MKT_REGULATED={
  'Financial & investment advice':['investment advice','financial advice','stock picks','trading signals','forex signals','crypto signals','guaranteed returns','portfolio management'],
  'Medical & health claims':['medical advice','cure cancer','miracle cure','diagnose','prescription','treatment plan','weight loss guaranteed'],
  'Legal advice':['legal advice','legal representation','sue someone'],
  'Adult (18+)':['adult content','nsfw','erotica','porn'],
};
const _MKT_RISK=['hack','exploit','crack','bypass','scrape','scraper','bot farm','mass dm','spam','password','credential','proxy list','account generator','otp bypass','2fa bypass','crypto','forex','trading bot','arbitrage','airdrop','pump','guaranteed','get rich','make money fast','mlm','downline','unlimited','premium free'];

// Screen a listing (mirrors the server). Returns {ok, action, category, reason, signals}
function _mktScreen(item, verifiedFor){
  const raw=[item.title,item.desc,item.cat,item.text,(item.files||[]).map(f=>f&&f.name).join(' ')].map(x=>String(x||'')).join(' ');
  const n=_mktNorm(raw);
  const hit=(term)=>{
    const t=_mktNorm(term);
    const esc=t.spaced.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(new RegExp('(^| )'+esc+'( |$)','i').test(n.spaced)) return true;
    if(t.squeezed.length>=6 && n.squeezed.includes(t.squeezed)) return true;
    return false;
  };
  for(const [category,terms] of Object.entries(_MKT_PROHIBITED)){
    for(const term of terms){ if(hit(term)) return { ok:false, action:'blocked', category, term,
      reason:'This listing appears to involve prohibited content ('+category+'). It can\u2019t be published. Selling this violates the Marketplace Terms and repeat violations suspend your selling access.' }; }
  }
  for(const [category,terms] of Object.entries(_MKT_REGULATED)){
    for(const term of terms){
      if(hit(term)){
        const ver=Array.isArray(verifiedFor)&&verifiedFor.includes(category);
        if(!ver) return { ok:false, action:'needs_verification', category, term,
          reason:category+' listings require a verified seller account. Apply for verification to sell in this category.' };
      }
    }
  }
  const signals=[];
  for(const term of _MKT_RISK){ if(hit(term)) signals.push(term); }
  if(signals.length) return { ok:true, action:'held_for_review', signals:signals.slice(0,5),
    reason:'Your listing will go live but is flagged for review. If it follows the rules it stays up; if not, it\u2019s removed.' };
  return { ok:true, action:'approved' };
}
try{ window._mktScreen=_mktScreen; window.MKT_POLICY=MKT_POLICY; }catch(e){}

/* Deliverable check: a listing must contain REAL, usable content for its kind,
   so a buyer always gets something that works - not an empty shell with big
   promises. Mirrors intent of the server gate. Returns {ok, reason}. */
function _mktDeliverableOK(item){
  const kind=item.kind||'prompt';
  const text=(item.text||'').trim();
  const files=item.files||[];
  const words=text?text.split(/\s+/).length:0;
  if(kind==='crew'||kind==='workflow'){
    if(words<8) return {ok:false, reason:'A '+kind+' must include the actual instructions it runs (what each step/agent should do) - at least a couple of sentences. Buyers run this, so an empty or vague listing is not allowed.'};
  } else if(kind==='prompt'){
    if(words<4) return {ok:false, reason:'A prompt listing must include the actual prompt text buyers will use. Paste the real prompt, not just a description.'};
  } else if(kind==='guide'||kind==='integration'){
    if(!text && !files.length) return {ok:false, reason:'Add the actual guide/setup content (text) or attach the files buyers receive.'};
  } else { // bundle / other
    if(!files.length && !text) return {ok:false, reason:'Attach at least one file, or add the text buyers receive.'};
  }
  return {ok:true};
}
try{ window._mktDeliverableOK=_mktDeliverableOK; }catch(e){}
// Which regulated categories this seller is verified for (operator-granted).
function _mktVerifiedFor(){ try{ return load('amv_mkt_verified')||[]; }catch(e){ return []; } }
try{ window._mktVerifiedFor=_mktVerifiedFor; }catch(e){}

// Shown when the automated review blocks a listing (or requires verification).
function _mktBlockedDialog(reason, action, category){
  const needsVer = action==='needs_verification';
  const r=$('ovr'); if(!r){ toast(reason,'error',7000); return; }
  const tint = needsVer ? 'var(--gold,#f5a623)' : 'var(--red)';
  const icon = needsVer
    ? '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
    : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  r.innerHTML='<div class="ovr-bg" id="mkb-bg"><div class="ovr-card" style="max-width:470px" onclick="event.stopPropagation()">'+
    '<div style="display:flex;gap:12px;align-items:flex-start">'+
      '<span style="width:38px;height:38px;flex-shrink:0;border-radius:10px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,'+tint+' 13%,transparent);color:'+tint+'">'+
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+icon+'</svg></span>'+
      '<div><div style="font-size:15px;font-weight:600;margin-bottom:6px">'+(needsVer?'Verification required':'Listing blocked by review')+'</div>'+
        '<div style="font-size:13px;color:var(--mu);line-height:1.6">'+escH(reason)+'</div></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'+
      (needsVer?'<button class="btn bs" id="mkb-apply" style="font-size:12px">Apply for verification</button>':'<button class="btn bs" id="mkb-rules" style="font-size:12px">See the terms</button>')+
      '<button class="btn bp" id="mkb-ok" style="font-size:12px">Got it</button>'+
    '</div></div></div>';
  r.classList.add('on');
  on($('mkb-ok'),'click',closeOvr);
  on($('mkb-bg'),'click',closeOvr);
  on($('mkb-rules'),'click',()=>{ closeOvr(); const b=$('mkt-rules-body'); if(b){ b.style.display='block'; b.scrollIntoView({behavior:'smooth',block:'center'}); } });
  on($('mkb-apply'),'click',()=>{ closeOvr(); toast('Verification for '+(category||'this category')+' is reviewed by our team. We\u2019ll email you once your seller account is approved.','info',5500); });
}
try{ window._mktBlockedDialog=_mktBlockedDialog; }catch(e){}

// Buyers can report a listing. Reports are stored and surfaced to the operator.
function _mktReport(itemId, title){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ovr-bg" id="mkr-bg"><div class="ovr-card" style="max-width:430px" onclick="event.stopPropagation()">'+
    '<div style="font-size:15px;font-weight:600;margin-bottom:4px">Report this listing</div>'+
    '<div style="font-size:12.5px;color:var(--mu);margin-bottom:14px">'+escH(title||'')+'</div>'+
    '<label class="lbl">What\u2019s wrong with it?</label>'+
    '<select id="mkr-reason" class="sel" style="width:100%;margin-bottom:10px">'+
      ['Illegal or prohibited content','Scam or fraud','Stolen / pirated material','Not as described','Sexual or abusive content','Hate or harassment','Something else']
        .map(o=>'<option>'+o+'</option>').join('')+
    '</select>'+
    '<textarea id="mkr-note" rows="3" placeholder="Any details that help us review it (optional)" style="width:100%;resize:vertical"></textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'+
      '<button class="btn bs" id="mkr-cancel" style="font-size:12px">Cancel</button>'+
      '<button class="btn bd2" id="mkr-send" style="font-size:12px">Submit report</button>'+
    '</div></div></div>';
  r.classList.add('on');
  on($('mkr-cancel'),'click',closeOvr);
  on($('mkr-bg'),'click',closeOvr);
  on($('mkr-send'),'click',()=>{
    try{
      const reports=load('amv_mkt_reports')||[];
      reports.push({ id:itemId, title:title||'', reason:$('mkr-reason')?.value||'', note:($('mkr-note')?.value||'').slice(0,500), by:(S.user&&S.user.email)||'', ts:Date.now() });
      store('amv_mkt_reports',reports);
    }catch(e){}
    closeOvr();
    toast('Report submitted - our review team will look at this listing.','success',4000);
  });
}
try{ window._mktReport=_mktReport; }catch(e){}

function _mktSell(body){
  if(!body) return;
  body.innerHTML=
    '<div class="ss2"><h3>List something for sale</h3>'+
      '<p style="font-size:12.5px;color:var(--mu);margin:0 0 12px;line-height:1.6">Sell AMV prompts, crews, integrations, workflows, guides - or attach any files (PDFs, videos, models, datasets, images). Set any price (or free). You keep <b style="color:var(--tx)">80%</b> of every sale; it lands in your balance to withdraw. AMV-only - listings can\u2019t reference other AI products.</p>'+
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
          '<div><label class="lbl">Type</label><select id="sl-kind" class="sel"><option value="prompt">Prompt</option><option value="crew">Crew</option><option value="integration">Integration</option><option value="workflow">Workflow</option><option value="guide">Guide</option><option value="bundle">File bundle</option></select></div>'+
          '<div style="width:110px"><label class="lbl">Price (USD)</label><input id="sl-price" type="number" min="0" max="999" value="0" inputmode="numeric"></div>'+
        '</div>'+
        '<div><label class="lbl">Category</label><input id="sl-cat" placeholder="e.g. Finance"></div>'+
        '<div><label class="lbl">Short description</label><input id="sl-desc" placeholder="What does the buyer get?"></div>'+
        '<div><label class="lbl">The deliverable <span style="color:var(--mu);font-weight:400">(text, instructions, links - optional if you attach files)</span></label><textarea id="sl-text" rows="5" placeholder="Paste the content buyers get: a prompt, instructions, a link to a video, anything\u2026" style="font-family:var(--mn,ui-monospace,monospace);font-size:13px"></textarea></div>'+
        '<div><label class="lbl">Attach files <span style="color:var(--mu);font-weight:400">(PDF, video, models, images, any file - delivered on purchase)</span></label>'+
          '<div id="sl-drop" class="sl-drop"><input type="file" id="sl-files" multiple style="display:none"><span>\uD83D\uDCCE Click to add files, or drag them here</span></div>'+
          '<div id="sl-filelist" class="sl-filelist"></div>'+
        '</div>'+
        '<button class="btn bp" id="sl-publish" style="align-self:flex-start;font-size:12px">List it</button>'+
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
    if(!items.length){ el.innerHTML='<div style="color:var(--mu);font-size:12px">No listings yet. Create one above.</div>'; return; }
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
      if(!confirm('Remove this listing permanently? Buyers who already own it keep it.')) return;
      try{ await AMVMarket.unlist(b.dataset.slDel); toast('Listing removed','info'); loadMine(); }catch(e){ toast(e.message||'Could not remove','error'); }
    }));
  }).catch(e=>{
    /* "No listings yet. Create one above." to a seller whose listings simply
       could not be fetched invites them to publish a duplicate. */
    const el=$('sl-mine'); if(!el) return;
    const sum=$('sl-summary'); if(sum) sum.innerHTML='';
    el.innerHTML='<div style="color:var(--mu);font-size:12px;line-height:1.6">'+
      escH((e&&e.message)||'Could not load your listings.')+
      ' They are still there. <button class="btn bs" id="sl-mine-retry" style="font-size:11.5px;margin-left:6px">Try again</button></div>';
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
// file helpers
function _fmtBytes(n){ if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
function _fileIcon(type,name){
  const t=(type||'')+' '+(name||'').toLowerCase();
  const svg=(p)=>'<svg class="file-ic-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
  if(/pdf|doc|word/.test(t)) return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>');
  if(/video|mp4|mov|webm|avi/.test(t)) return svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>');
  if(/image|png|jpg|jpeg|gif|svg|webp/.test(t)) return svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>');
  if(/zip|rar|7z|tar|gz/.test(t)) return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 12h1v1h-1zM11 14h1v1h-1zM10 16h1v1h-1z"/>');
  if(/csv|xls|sheet|numbers/.test(t)) return svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>');
  if(/json|model|gguf|safetensors|bin|onnx|pt|ckpt|h5|pkl/.test(t)) return svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="2"/>');
  if(/audio|mp3|wav|m4a/.test(t)) return svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
  return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>');
}
window._fileIcon=_fileIcon; window._fmtBytes=_fmtBytes;
/* Marketplace/project icons come from listing DATA and are rendered UNescaped
   (they can legitimately be one of our own file-type SVGs). On the client the
   field is only ever a trusted _fileIcon SVG or a plain emoji, but a crafted
   API listing could smuggle arbitrary markup into `icon` and it would execute
   in another user's browser when they browse. Sanitize on render: allow ONLY
   our own generated file-type SVGs (exact match) or a plain-text emoji
   (escaped); anything else falls back to a sparkle. Defense in depth - the
   server must also constrain this field. */
let _ICON_SAFE_SET=null;
function _iconSafeSet(){
  if(_ICON_SAFE_SET) return _ICON_SAFE_SET;
  _ICON_SAFE_SET=new Set();
  try{ ['pdf','video','image','zip','csv','json','audio',''].forEach(t=>_ICON_SAFE_SET.add(_fileIcon(t,''))); }catch(e){}
  return _ICON_SAFE_SET;
}
function _safeIcon(ic){
  ic=(ic==null?'':String(ic));
  if(!ic) return '✨';
  if(ic.indexOf('<')<0) return escH(ic.slice(0,12));   // emoji / text label
  return _iconSafeSet().has(ic) ? ic : '✨';        // only our own SVGs pass
}
window._safeIcon=_safeIcon;
// Turn a stored file (data URL) back into a real download.
function _downloadFile(f){
  try{
    const a=document.createElement('a'); a.href=f.data; a.download=f.name||'download';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Downloading '+(f.name||'file'),'info',2500);
  }catch(e){ toast('Could not download file','error'); }
}
window._downloadFile=_downloadFile;
function _mktEarnings(body){
  if(!body) return;
  body.innerHTML='<div class="fd-loading">Loading your earnings\u2026</div>';
  AMVMarket.earnings().then(d=>{
    const bal=(d.balance||0), life=(d.lifetime||0), pct=d.sellerPct||80, min=d.minWithdraw||10;
    const txLabel={sale:'Sale',withdrawal:'Withdrawal'};
    const tx=(d.tx||[]).map(t=>'<div class="vrow"><span>'+(txLabel[t.type]||t.type)+(t.title?' \u00b7 '+escH(t.title):'')+(t.status?' <span style="color:var(--mu);font-size:11px">('+t.status+')</span>':'')+'</span>'+
      '<span class="vrow-n" style="color:'+(t.amount<0?'var(--mu)':'#4ade80')+'">'+(t.amount<0?'-$'+Math.abs(t.amount).toFixed(2):'+$'+t.amount.toFixed(2))+'</span></div>').join('')||'<div class="vrow"><span style="color:var(--mu)">No earnings yet - sell something to start.</span></div>';
    body.innerHTML=
      '<div class="vhero">'+
        '<div class="vcard vcard-accent"><div class="vcard-n">$'+bal.toFixed(2)+'</div><div class="vcard-l">Available to withdraw</div></div>'+
        '<div class="vcard"><div class="vcard-n">$'+life.toFixed(2)+'</div><div class="vcard-l">Lifetime earnings</div></div>'+
        '<div class="vcard"><div class="vcard-n">'+pct+'%</div><div class="vcard-l">Your share of each sale</div></div>'+
      '</div>'+
      '<div class="ss2"><h3>Withdraw your balance</h3>'+
        '<p style="font-size:12.5px;color:var(--mu);margin:0 0 12px;line-height:1.6">Minimum withdrawal is $'+min+'. Enter where you\u2019d like the funds sent (PayPal email or bank reference) and we\u2019ll process the payout.</p>'+
        '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;max-width:520px">'+
          '<div style="flex:1;min-width:200px"><label class="lbl">Payout destination</label><input id="wd-dest" placeholder="PayPal email or bank reference"></div>'+
          '<button class="btn bp" id="wd-go" style="font-size:12px"'+(bal<min?' disabled':'')+'>Withdraw $'+bal.toFixed(2)+'</button>'+
        '</div>'+
        (bal<min?'<div style="font-size:11.5px;color:var(--mu);margin-top:8px">You need at least $'+min+' to withdraw.</div>':'')+
      '</div>'+
      '<div class="ss2"><h3>Transaction history</h3><div class="vbreak">'+tx+'</div></div>';
    on($('wd-go'),'click',async()=>{
      const dest=($('wd-dest')?.value||'').trim();
      if(!dest){ toast('Enter where to send your payout','error'); return; }
      const btn=$('wd-go'); if(btn){btn.disabled=true;btn.textContent='Requesting\u2026';}
      try{ const r=await AMVMarket.withdraw(dest); toast('Withdrawal of $'+r.amount.toFixed(2)+' requested - it\u2019s now processing.','success',5000); _mktEarnings(body); }
      catch(e){ if(btn){btn.disabled=false;btn.textContent='Withdraw';} toast(e.message||'Could not withdraw','error',5000); }
    });
  }).catch(e=>{
    /* Never a fabricated zero. The screen says it could not read the balance,
       which is a different statement from "you are owed nothing". */
    body.innerHTML='<div class="ss2"><h3>Could not load your earnings</h3>'+
      '<p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0 0 12px">'+
      escH((e&&e.message)||'AMV could not reach the server.')+
      ' Nothing has changed - your balance is whatever it was.</p>'+
      '<button class="btn bs" id="mkt-earn-retry" style="font-size:12px">Try again</button></div>';
    on($('mkt-earn-retry'),'click',()=>_mktEarnings(body));
  });
}

/* === MEMORY === */
function renderMemoryView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<h2>AI Memory</h2>'+
      '<p class="vsub">AMV remembers facts about you to personalize every response. These memories are included with every AI request.</p>'+
      '<div style="display:flex;gap:8px">'+
        '<input type="text" id="mem-inp" placeholder="Add a memory - e.g. I am a software engineer or I prefer concise answers" style="flex:1;font-size:13px">'+
        '<button class="btn bp" id="mem-add" style="font-size:12px;white-space:nowrap">Add Memory</button>'+
      '</div>'+
      '<div id="mem-list" style="display:flex;flex-direction:column;gap:8px"></div>'+
      (S.memory.length?'<button class="btn bd2" id="mem-clr" style="align-self:flex-start;font-size:12px">Clear All Memories</button>':'')+
      '<div class="ss2 ds-note">'+
        '<h3>How Memory Works</h3>'+
        '<p style="font-size:12px;color:var(--t2);line-height:1.65">Memories you add here are automatically included in every conversation with AMV, allowing for more personalized and contextual responses. Add facts about yourself, your preferences, your work, or anything you want AMV to always know.</p>'+
        '<div style="margin-top:9px;font-size:12px;color:var(--t2)">Examples:'+
          '<div style="display:flex;flex-direction:column;gap:3px;margin-top:5px">'+
            '<span style="color:var(--tx)">• "I am a software engineer who works with Python and React"</span>'+
            '<span style="color:var(--tx)">• "I prefer concise, direct answers without unnecessary preamble"</span>'+
            '<span style="color:var(--tx)">• "I am studying for the GRE and need exam-level explanations"</span>'+
            '<span style="color:var(--tx)">• "My company sells B2B SaaS software to healthcare companies"</span>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div></div>';
  
  on($('mem-add'),'click',addMemory);
  on($('mem-inp'),'keydown',e=>{if(e.key==='Enter')addMemory();});
  on($('mem-clr'),'click',()=>{S.memory=[];renderMemoryView();toast('All memories cleared','success');});
  renderMemList();
}
function addMemory(){
  const inp=$('mem-inp'); if(!inp) return;
  const text=inp.value.trim(); if(!text) return;
  S.memory=[{id:'m'+Date.now(),text,added:Date.now()},...S.memory];
  inp.value='';
  renderMemList();
  toast('Memory saved','success');
}
function renderMemList(){
  const list=$('mem-list'); if(!list) return;
  if(!S.memory.length){list.innerHTML=emptyState({svg:'<path d="M12 5a3 3 0 0 0-5.9-.7 3 3 0 0 0-1.6 5.2A3 3 0 0 0 6 15a3 3 0 0 0 6 .5 3 3 0 0 0 6-.5 3 3 0 0 0 1.5-5.5 3 3 0 0 0-1.6-5.2A3 3 0 0 0 12 5z"/>',title:'No memories yet',sub:'Tell AMV things to remember about you - your name, preferences, projects - and it\u2019ll use them in every chat.',btn:{label:'Add your first memory',act:'_focusMemInput'}});return;}
  const pg=_paginate('memory', S.memory.length, 30);
  list.innerHTML=S.memory.slice(0, pg.shown).map(m=>
    '<div class="memc">'+
      '<div class="memic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" stroke-width="2" stroke-linecap="round"><path d="M12 2a5 5 0 1 0 5 5H7a5 5 0 0 0 5-5z"/><path d="M12 12v10"/></svg></div>'+
      '<div style="flex:1"><div class="memt">'+escH(m.text)+'</div><div class="memtm">Added '+new Date(m.added).toLocaleDateString()+'</div></div>'+
      '<button class="memdel" data-dact="delMemory" data-darg="'+escH(m.id)+'">×</button>'+
    '</div>'
  ).join('') + (pg.hasMore ? _showMoreBtn('memory', pg.remaining, 30) : '');
  const mb=list.querySelector('[data-pagemore="memory"]');
  if(mb) mb.addEventListener('click',()=>{ _pageMore('memory',30); renderMemList(); });
}
function delMemory(id){
  S.memory=S.memory.filter(m=>m.id!==id);
  renderMemList();
}

/* ============================================================
   PERSISTENT MEMORY THAT IMPROVES OVER TIME
   After conversations, AMV extracts durable facts about the user
   (name, preferences, projects, goals), deduplicates them, and keeps
   them synced. Relevant memories are injected into every chat so the
   assistant genuinely remembers and gets more useful each session.
   ============================================================ */
let _memExtractBusy=false;
async function _maybeExtractMemory(msgs){
  try{
    if(_memExtractBusy) return;
    if(!_aiBackendReady()) return;
    // only run occasionally (every few exchanges) to keep it cheap
    const userTurns=msgs.filter(m=>m.r==='u').length;
    if(userTurns<2 || userTurns%3!==0) return;
    _memExtractBusy=true;
    const recent=msgs.slice(-8).map(m=>(m.r==='u'?'User: ':'AMV: ')+(typeof m.c==='string'?m.c:'').slice(0,400)).join('\n');
    const existing=S.memory.map(m=>m.text).join(' | ')||'(none yet)';
    const sys='Extract durable facts worth remembering about the USER from this conversation '+
      '(their name, role, preferences, ongoing projects, goals, constraints). '+
      'Return ONLY a JSON array of short fact strings. Skip anything already known. '+
      'Return [] if nothing new. Already known: '+existing;
    const out=await aiComplete(recent, sys, {json:true, max_tokens:300, noLang:true});
    let facts=[]; try{ facts=JSON.parse(String(out).replace(/```json|```/g,'').trim()); }catch(e){}
    if(!Array.isArray(facts)||!facts.length){ _memExtractBusy=false; return; }
    const known=new Set(S.memory.map(m=>m.text.toLowerCase().trim()));
    const fresh=facts.filter(f=>typeof f==='string'&&f.trim()&&!_memDuplicate(f,known)).slice(0,5);
    if(fresh.length){
      S.memory=[...fresh.map(f=>({id:'m'+Date.now()+Math.random().toString(36).slice(2,5),text:f.trim(),added:Date.now(),auto:true})), ...S.memory].slice(0,200);
      if(typeof renderMemList==='function' && S.tab==='memory') renderMemList();
    }
  }catch(e){ /* extraction is best-effort */ }
  finally{ _memExtractBusy=false; }
}
function _memDuplicate(fact, knownSet){
  const f=fact.toLowerCase().trim();
  if(knownSet.has(f)) return true;
  // fuzzy: high word overlap with an existing memory = duplicate
  const fw=new Set(f.split(/\W+/).filter(w=>w.length>3));
  for(const k of knownSet){
    const kw=new Set(k.split(/\W+/).filter(w=>w.length>3));
    if(!fw.size||!kw.size) continue;
    let common=0; fw.forEach(w=>{ if(kw.has(w)) common++; });
    if(common/Math.min(fw.size,kw.size) >= 0.7) return true;
  }
  return false;
}
/* Pick the memories most relevant to the current conversation to inject
   (keeps the prompt focused instead of dumping everything). */
function _relevantMemories(msgs, limit){
  limit=limit||12;
  if(S.memory.length<=limit) return S.memory.map(m=>m.text);
  const ctx=msgs.slice(-4).map(m=>typeof m.c==='string'?m.c:'').join(' ').toLowerCase();
  const ctxWords=new Set(ctx.split(/\W+/).filter(w=>w.length>3));
  const scored=S.memory.map(m=>{
    const mw=m.text.toLowerCase().split(/\W+/).filter(w=>w.length>3);
    let score=0; mw.forEach(w=>{ if(ctxWords.has(w)) score++; });
    return {text:m.text, score, added:m.added||0};
  });
  scored.sort((a,b)=> b.score-a.score || b.added-a.added);
  return scored.slice(0,limit).map(s=>s.text);
}


/* === PROMPT LIBRARY === */
const PL_CATS=['All','Writing','Coding','Business','Education','Creative','Math','Language','Analysis','Career','3D'];

function renderPromptsView(){
  const vc=$('vc'); if(!vc) return;
  const cats=PL_CATS.map(c=>'<button class="stb '+(c==='All'?'on':'')+'" data-cat="'+c+'">'+c+'</button>').join('');
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<h2>Prompt Library</h2>'+
      '<p class="vsub">Ready-to-use prompts for every task. Click any prompt to load it into chat, or create your own.</p>'+
      '<div style="display:flex;gap:8px;margin-bottom:4px">'+
        '<input type="text" id="pl-search" placeholder="Search prompts…" style="flex:1;font-size:13px">'+
        '<button class="btn bp" id="pl-new" style="font-size:12px;white-space:nowrap">+ Create</button>'+
      '</div>'+
      '<div style="display:flex;gap:5px;flex-wrap:wrap" id="pl-cats">'+cats+'</div>'+
      '<div id="pl-list" style="display:flex;flex-direction:column;gap:8px"></div>'+
    '</div></div>';
  
  let activeCat='All';
  document.querySelectorAll('#pl-cats .stb').forEach(b=>{
    on(b,'click',()=>{ activeCat=b.dataset.cat; document.querySelectorAll('#pl-cats .stb').forEach(x=>x.classList.toggle('on',x===b)); renderPLList(activeCat); });
  });
  on($('pl-search'),'input',()=>renderPLList(activeCat));
  on($('pl-new'),'click',createPromptModal);
  renderPLList('All');
}
function renderPLList(cat){
  const list=$('pl-list'); if(!list) return;
  const search=($('pl-search')?.value||'').toLowerCase();
  let prompts=S.prompts;
  if(cat!=='All') prompts=prompts.filter(p=>p.cat===cat);
  if(search) prompts=prompts.filter(p=>p.title.toLowerCase().includes(search)||p.text.toLowerCase().includes(search));
  if(!prompts.length){list.innerHTML=emptyState({icon:'\uD83D\uDD0D',title:'No prompts found',sub:'Try a different search or category - or create your own prompt with the + Create button above.',btn:{label:'Create a prompt',act:'_newPromptCTA'}});return;}
  list.innerHTML=prompts.map(p=>
    '<div class="plc">'+
      '<div class="plt"><span>'+escH(p.title)+'</span><span class="plcat">'+p.cat+'</span></div>'+
      '<div class="pltx">'+escH(p.text)+'</div>'+
      '<div style="display:flex;gap:5px;margin-top:9px">'+
        '<button class="btn bp" style="font-size:11px;padding:4px 11px" data-dact="usePrompt" data-darg="'+p.id+'">Use Prompt</button>'+
        '<button class="btn bs" style="font-size:11px;padding:4px 11px" data-dact="copyPrompt" data-darg="'+p.id+'">Copy</button>'+
        (p.custom?'<button class="btn bd2" style="font-size:11px;padding:4px 11px" data-dact="deletePrompt" data-darg="'+p.id+'">Delete</button>':'')+
      '</div>'+
    '</div>'
  ).join('');
}
function usePrompt(id){
  const p=S.prompts.find(x=>x.id===id); if(!p) return;
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta){ta.value=p.text;ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,130)+'px';ta.focus();} },100);
  toast('Prompt loaded into chat','success');
}
function copyPrompt(id){
  const p=S.prompts.find(x=>x.id===id); if(!p) return;
  navigator.clipboard?.writeText(p.text).then(()=>toast('Prompt copied','success'));
}
function deletePrompt(id){
  S.prompts=S.prompts.filter(p=>p.id!==id);
  store('amv_pl',S.prompts);
  renderPLList('All');
}
function createPromptModal(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="cp-bg"><div class="ob wide" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">×</button>'+
      '<h2 style="margin-bottom:4px">Create Prompt</h2>'+
      '<p class="ob-sub">Add a reusable prompt to your personal library.</p>'+
      '<div class="af">'+
        '<div><label class="lbl">Title</label><input type="text" id="cp-title" placeholder="e.g. Write a cover letter"></div>'+
        '<div><label class="lbl">Category</label><select id="cp-cat">'+PL_CATS.filter(c=>c!=="All").map(c=>'<option>'+c+'</option>').join('')+'</select></div>'+
        '<div><label class="lbl">Prompt Text</label><textarea id="cp-text" placeholder="Write your prompt here. Use [BRACKETS] for variables." rows="5" style="min-height:100px"></textarea></div>'+
        '<button class="btn bp" id="cp-save" style="width:100%;padding:11px">Save to Library</button>'+
      '</div>'+
    '</div></div>';
  on($('cp-bg'),'click',closeOvr);
  on($('cp-save'),'click',()=>{
    const t=$('cp-title')?.value.trim(),c=$('cp-cat')?.value,tx=$('cp-text')?.value.trim();
    if(!t||!tx){toast('Title and prompt text required','error');return;}
    S.prompts.unshift({id:'p'+Date.now(),title:t,cat:c,text:tx,custom:true});
    store('amv_pl',S.prompts);
    closeOvr();
    renderPromptsView();
    toast('Prompt saved to library','success');
  });
}


/* === WORKSPACES === */
function renderWorkspacesView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Projects</span>'+
      '<h2>Projects</h2>'+
      '<p class="vsub">Group related chats, builds, and research into a project so AMV keeps the full context together.</p>'+
      '<button class="btn bp" id="ws-new" style="align-self:flex-start">+ New project</button>'+
      '<div class="wg" id="ws-grid"></div>'+
    '</div></div>';
  on($('ws-new'),'click',createWorkspaceModal);
  renderWsGrid();
}
function renderWsGrid(){
  const g=$('ws-grid'); if(!g) return;
  const allConvs=Array.isArray(S.convs)?S.convs:[];
  if(!S.workspaces||!S.workspaces.length){
    g.innerHTML='<div class="proj-empty">'+
      '<div class="proj-empty-ic">📁</div>'+
      '<div class="proj-empty-t">No projects yet</div>'+
      '<div class="proj-empty-d">Start a project to keep related chats, builds, and research in one place. AMV remembers everything inside it.</div>'+
      '<button class="btn bp" data-dact="newProjectCTA">+ Start new project</button>'+
    '</div>';
    return;
  }
  g.innerHTML=S.workspaces.map(ws=>{
    const chats=allConvs.filter(c=>c.wsId===ws.id);
    const preview=chats.slice(0,3).map(c=>'<div class="wsc-chat" data-dact="loadConv" data-darg="'+c.id+'" onclick="event.stopPropagation()" style="font-size:12px;color:var(--mu);padding:4px 0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\u2022 '+escH(c.title||'Untitled')+'</div>').join('');
    return '<div class="wsc" data-dact="openWorkspace" data-darg="'+ws.id+'">'+
      '<div class="wsic" style="background:rgba(85,144,255,.1)">'+ws.icon+'</div>'+
      '<div class="wsn">'+escH(ws.name)+'</div>'+
      '<div class="wsd">'+escH(ws.desc||'')+'</div>'+
      (preview?'<div style="margin:8px 0 4px">'+preview+(chats.length>3?'<div style="font-size:11px;color:var(--dim);padding-top:2px">+'+(chats.length-3)+' more</div>':'')+'</div>':'<div class="wsc-empty">No chats yet - open to start one</div>')+
      '<div class="wsm">'+chats.length+' chat'+(chats.length===1?'':'s')+' \u00b7 '+new Date(ws.created||Date.now()).toLocaleDateString()+'</div>'+
    '</div>';
  }).join('')+'<button class="wsc wsc-add" data-dact="newProjectCTA"><div class="wsc-add-ic">+</div><div class="wsn">New project</div><div class="wsd">Start a fresh workspace</div></button>';
}
function newProjectCTA(){ createWorkspaceModal(); }
window.newProjectCTA=newProjectCTA;
function openWorkspace(id){
  const ws=S.workspaces.find(w=>w.id===id);
  if(!ws) return;
  // find this project's most recent chat, or start a new one tagged to it
  let conv=(Array.isArray(S.convs)?S.convs:[]).find(c=>c.wsId===id);
  if(!conv){
    conv=newConvObj((ws.name||'Project')+' chat');
    conv.wsId=id;
    S.convs.unshift(conv);
    _autoSave();
  }
  S.cur=conv.id;
  setTab('chat');
  renderHist();
  toast('Opened project: '+(ws.name||''),'info');
}
function createWorkspaceModal(){
  const r=$('ovr'); if(!r) return;
  const icons=['📁','💼','🔬','🎨','💻','📊','✍️','🏠','🎯','🚀','📚','⚡'];
  r.innerHTML=
    '<div class="ov" id="ws-bg"><div class="ob" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">×</button>'+
      '<h2 style="margin-bottom:4px">New Workspace</h2>'+
      '<p class="ob-sub">Create a workspace to organize related conversations.</p>'+
      '<div class="af">'+
        '<div><label class="lbl">Name</label><input type="text" id="ws-name" placeholder="e.g. Research Project"></div>'+
        '<div><label class="lbl">Description</label><input type="text" id="ws-desc" placeholder="What is this workspace for?"></div>'+
        '<div><label class="lbl">Icon</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+icons.map(ic=>'<button class="ws-ic-btn" data-ic="'+ic+'" style="width:34px;height:34px;border-radius:7px;border:1px solid var(--bd);background:var(--s2);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all .12s">'+ic+'</button>').join('')+'</div></div>'+
        '<button class="btn bp" id="ws-create" style="width:100%;padding:11px">Create Workspace</button>'+
      '</div>'+
    '</div></div>';
  let selIcon='📁';
  document.querySelectorAll('.ws-ic-btn').forEach(b=>{
    on(b,'click',()=>{ selIcon=b.dataset.ic; document.querySelectorAll('.ws-ic-btn').forEach(x=>x.style.borderColor=x===b?'var(--indigo)':''); });
  });
  on($('ws-bg'),'click',closeOvr);
  on($('ws-create'),'click',()=>{
    const n=$('ws-name')?.value.trim(),d=$('ws-desc')?.value.trim();
    if(!n){toast('Name required','error');return;}
    S.workspaces.unshift({id:'ws'+Date.now(),name:n,icon:selIcon,desc:d||'',created:Date.now(),convs:[]});
    store('amv_ws',S.workspaces);
    closeOvr(); renderWorkspacesView();
    toast('Workspace created','success');
  });
}


/* === USAGE / VALUE DASHBOARD === */
/* Shared usage content - used by the standalone view AND the Settings pane,
   so they never drift. Returns inner HTML (no outer .sv/.vi wrapper). */
function _usageContentHTML(){
  const mc=getMsgs().length,ic=S.imgs.length;
  const week=AMVValue.stats(7), all=AMVValue.stats(null);
  const typeLabel={message:'Conversations',image:'Images',video:'Videos',code:'Code tasks',document:'Documents',agent_action:'Autonomous actions',research:'Research',design:'Designs'};
  const breakdown=Object.entries(all.byType).sort((a,b)=>b[1]-a[1]).map(([t,n])=>
    '<div class="vrow"><span>'+(typeLabel[t]||t)+'</span><span class="vrow-n">'+n+'</span></div>').join('')||'<div class="vrow"><span style="color:var(--mu)">Nothing yet - start a chat to see your impact grow.</span></div>';
  // --- Task #7: rolling usage window ---
  const us=AMVUsage.status();
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
      (us.pct>=90?'<div class="usage-warn">You\u2019re nearly out for this window. It refreshes in '+AMVUsage.resetLabel()+', or <a data-stab="plans" style="color:var(--accent);cursor:pointer">upgrade for more &rarr;</a></div>':'')+
      '<p class="usage-note">Your usage refreshes on a rolling '+us.windowHours+'-hour window - no daily lockout. Heavier plans get a bigger allowance per window.</p>'+
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
  const serverPanel = (window.AMV_API && AMV_API.live && AMV_API.token)
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
      usagePanel+
      trendPanel+
      '<div class="ss2"><h3>What you\u2019ve used</h3><div class="vbreak">'+breakdown+'</div></div>'+
      '<div class="ss2"><h3>Today\u2019s plan usage</h3>'+
        '<div style="display:flex;flex-direction:column;gap:10px">'+
          '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mu);margin-bottom:4px"><span>Messages</span><span>'+mc+' / 30</span></div><div class="sbb"><div class="sbf2" style="width:'+Math.min(mc/30*100,100)+'%"></div></div></div>'+
          '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mu);margin-bottom:4px"><span>Images</span><span>'+ic+' / 4</span></div><div class="sbb"><div class="sbf2" style="width:'+Math.min(ic/4*100,100)+'%"></div></div></div>'+
        '</div>'+
        '<button class="btn bp" data-stab="plans" style="margin-top:14px;font-size:12px">Upgrade for more &rarr;</button>'+
      '</div>'+
      (isAdmin()? (function(){var u=AEGIS.usage();var cap=AEGIS.cfg.dailyTokenCap;var used=u.inTok+u.outTok;var pct=Math.min(used/cap*100,100);return '<div class="ss2" style="margin-top:18px"><h3>Token usage &amp; cost (today) - operator</h3>'+'<div class="stg" style="margin-bottom:12px">'+'<div class="stc"><div class="stv">'+u.reqs+'</div><div class="stl">API requests</div></div>'+'<div class="stc"><div class="stv">'+u.inTok.toLocaleString()+'</div><div class="stl">Input tokens</div></div>'+'<div class="stc"><div class="stv">'+u.outTok.toLocaleString()+'</div><div class="stl">Output tokens</div></div>'+'<div class="stc"><div class="stv">$'+u.costUSD.toFixed(3)+'</div><div class="stl">Est. cost</div></div>'+'</div>'+'<div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mu);margin-bottom:4px"><span>Daily token cap (this device)</span><span>'+used.toLocaleString()+' / '+cap.toLocaleString()+'</span></div><div class="sbb"><div class="sbf2" style="width:'+pct+'%"></div></div></div>'+'<div style="display:flex;gap:8px;margin-top:12px"><button class="btn bs" data-dact="aegisExport" style="font-size:12px">Export audit log</button><button class="btn bs" data-dact="aegisClear" style="font-size:12px">Clear log</button></div>'+'</div>';})() : '');
}
window._usageContentHTML=_usageContentHTML;

/* Fills the server-truth panel once the numbers arrive. Kept out of the HTML
   builder so a slow or failed request never delays the rest of the screen. */
function _paintServerUsage(){
  const host = document.getElementById('srv-usage');
  if(!host || !(window.AMV_API && AMV_API.live && AMV_API.token)) return;
  AMV_API.usage().then(d=>{
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
    host.innerHTML =
      '<h3>Your plan allowance</h3>'+
      '<p class="srv-sub">Counted by AMV\u2019s servers - these are the limits that actually apply.</p>'+
      '<div class="srv-row"><div class="srv-lbl"><span>Today</span><span>'+n(d.day.used)+' / '+n(d.day.limit)+'</span></div>'+bar(d.day.used, d.day.limit)+'</div>'+
      '<div class="srv-row"><div class="srv-lbl"><span>This month</span><span>'+n(d.month.used)+' / '+n(d.month.limit)+'</span></div>'+bar(d.month.used, d.month.limit)+'</div>'+
      (bonus > 0
        ? '<div class="srv-bonus">Includes <b>+'+n(bonus)+'</b> bonus tokens from invites you have earned. '+
          '<a data-sp-go="invite" style="color:var(--accent);cursor:pointer">See your invites &rarr;</a></div>'
        : '')+
      (d.shared && d.shared.team
        ? '<div class="srv-bonus">These numbers are your <b>whole team</b>, not just you - one subscription is one allowance, '+
          'however many people are on it. <a data-sp-team="1" style="color:var(--accent);cursor:pointer">Open Team &rarr;</a></div>'
        : '')+
      '<p class="srv-note">Your plan is '+escH(String(d.plan||'free'))+'. Daily and monthly allowances are separate: running out today does not spend your month.</p>';
    const go = host.querySelector('[data-sp-go]');
    if(go) on(go,'click',()=>{ S.settingsPane='invite'; S.tab='settings'; setTab('settings'); });
    const tm = host.querySelector('[data-sp-team]');
    if(tm) on(tm,'click',()=>{ S.tab='team'; setTab('team'); });
  }).catch(()=>{
    host.innerHTML = '<h3>Your plan allowance</h3><div class="srv-off">Could not reach the server, so your real allowance is not shown. The figures below are this device\u2019s own tally.</div>';
  });
}
try{ window._paintServerUsage=_paintServerUsage; }catch(e){}

