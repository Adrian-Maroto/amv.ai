/* Shared interface behavior. No new provider capability is implied by a card. */
function fitChatComposer(el){
  if(!el)return;
  const viewport=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||800;
  const max=Math.max(120,Math.min(520,Math.round(viewport*0.48)));
  el.style.height='auto';
  const needed=Math.max(44,el.scrollHeight||44);
  el.style.height=Math.min(needed,max)+'px';
  el.style.maxHeight=max+'px';
  el.style.overflowY=needed>max?'auto':'hidden';
}
async function shareAnswer(idx){
  const m=getMsgs()[idx];if(!m)return;
  const text=String(m.d||(typeof m.c==='string'?m.c:''));if(!text)return;
  try{
    // Share this answer's text only. No public URL, no hidden context/history.
    if(navigator.share)await navigator.share({title:'AMV',text});
    else{await navigator.clipboard.writeText(text);toast(T('Answer copied.'),'success');}
  }catch(e){if(e&&e.name!=='AbortError')toast(T('Sharing isn’t available here. Use Copy instead.'),'info');}
}
function answerMore(idx,button){
  const bar=button.closest('.mact-bar');if(!bar)return;
  const open=bar.classList.toggle('show-secondary');
  button.setAttribute('aria-expanded',String(open));
}
function _productCountryHTML(id){
  const code=typeof _cwCountryGuess==='function'?_cwCountryGuess():'';
  const rows=typeof CW_WORLD_COUNTRIES!=='undefined'?CW_WORLD_COUNTRIES:[];
  return '<div class="product-country"><label for="'+escH(id)+'">'+escH(T('Country'))+'</label><select class="inp" id="'+escH(id)+'">'+
    '<option value="" '+(!code?'selected':'')+'>'+escH(T('Choose a country'))+'</option>'+
    rows.slice().sort((a,b)=>a[1].localeCompare(b[1])).map(r=>'<option value="'+escH(r[0])+'" '+(r[0]===code?'selected':'')+'>'+escH(r[1])+'</option>').join('')+
    '</select><span>'+escH(T('Sets the banks, shops and services shown. Change it anytime.'))+'</span></div>';
}
function _productCountryName(){
  const cc=typeof _cwCountryGuess==='function'?_cwCountryGuess():'';
  const r=typeof _cwCountryRow==='function'?_cwCountryRow(cc):null;
  return r?r[1]:'';
}

try{
  window.addEventListener('resize',()=>fitChatComposer(document.getElementById('mta')),{passive:true});
  window.visualViewport?.addEventListener('resize',()=>fitChatComposer(document.getElementById('mta')),{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mact-bar.show-secondary').forEach(b=>{b.classList.remove('show-secondary');b.querySelector('[data-action="answer-more"]')?.setAttribute('aria-expanded','false');});});
}catch(e){}
