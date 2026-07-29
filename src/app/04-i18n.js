/* =====================================================================
   EMBEDDABLE WIDGET - the compact chat panel shown inside the iframe that
   third-party sites load via /widget.js. It talks to the PUBLIC endpoint
   /v1/widget/chat using the site key from the URL (#embed=1&k=pk_...). No
   AMV account is needed; all trust/limits are enforced server-side.
   ===================================================================== */
function _checkEmbedView(){
  try{
    const h=location.hash||'';
    if(h.indexOf('embed=1')<0) return false;
    const km=h.match(/[#&]k=([a-zA-Z0-9_]+)/);
    const key=km?km[1]:'';
    _renderEmbedView(key);
    return true;
  }catch(e){ return false; }
}
function _embedApiBase(){
  // The widget calls the same backend the app is configured to use. In embed
  // mode there's no logged-in user, so read the deployed base from the global
  // config (set by the operator) or fall back to same-origin.
  try{ const b=loadStr('amv_api_base'); if(b) return b.replace(/\/+$/,''); }catch(e){}
  return location.origin;
}
function _renderEmbedView(key){
  document.title='Chat';
  document.body.className='';
  document.body.innerHTML=
    '<div class="emb-root">'+
      '<div class="emb-head">'+
        '<div class="emb-title" id="emb-title">Chat with us</div>'+
        '<button class="emb-x" id="emb-x" aria-label="Close">\u2715</button>'+
      '</div>'+
      '<div class="emb-msgs" id="emb-msgs"></div>'+
      '<div class="emb-input">'+
        '<textarea id="emb-ta" rows="1" placeholder="Type your message\u2026" aria-label="Message"></textarea>'+
        '<button class="emb-send" id="emb-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'+
      '</div>'+
      '<div class="emb-foot">Powered by <b>AMV.AI</b></div>'+
    '</div>';

  const msgsEl=document.getElementById('emb-msgs');
  const ta=document.getElementById('emb-ta');
  const sendBtn=document.getElementById('emb-send');
  const history=[];   // {role:'user'|'assistant', content:'...'}
  let busy=false;

  document.getElementById('emb-x').addEventListener('click',()=>{
    try{ if(window.parent && window.parent!==window) window.parent.postMessage({__amvWidget:'close'},'*'); }catch(e){}
  });

  function addMsg(role, text){
    const d=document.createElement('div');
    d.className='emb-msg '+(role==='user'?'emb-u':'emb-a');
    d.innerHTML='<div class="emb-bubble">'+(role==='user'?escH(text):md(String(text||'')))+'</div>';
    msgsEl.appendChild(d);
    msgsEl.scrollTop=msgsEl.scrollHeight;
    return d;
  }

  // Load this widget's config (title, greeting, accent) - public, safe fields only.
  (async()=>{
    try{
      const r=await fetch(_embedApiBase()+'/v1/widget/config-public?k='+encodeURIComponent(key)).catch(()=>null);
      // config-public is optional; if it 404s we just use defaults below.
      if(r&&r.ok){ const d=await r.json(); if(d&&d.config){
        if(d.config.title){ document.getElementById('emb-title').textContent=d.config.title; document.title=d.config.title; }
        if(d.config.accent){ document.documentElement.style.setProperty('--emb-accent', d.config.accent); }
        if(d.config.greeting){ addMsg('assistant', d.config.greeting); return; }
      }}
    }catch(e){}
    addMsg('assistant','Hi! How can I help you today?');
  })();

  ta.addEventListener('input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(120,ta.scrollHeight)+'px'; });
  ta.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
  sendBtn.addEventListener('click',send);

  async function send(){
    const text=ta.value.trim();
    if(!text||busy) return;
    if(!key){ addMsg('assistant','This chat widget isn\u2019t configured correctly.'); return; }
    ta.value=''; ta.style.height='auto';
    addMsg('user', text);
    history.push({role:'user', content:text});
    busy=true; sendBtn.disabled=true;

    const aEl=addMsg('assistant','');
    const bub=aEl.querySelector('.emb-bubble');
    bub.innerHTML='<span class="emb-dots"><i></i><i></i><i></i></span>';
    let acc='';
    try{
      const res=await fetch(_embedApiBase()+'/v1/widget/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ key, messages:history.slice(-20) })
      });
      if(!res.ok){
        let em='The assistant is unavailable right now.';
        try{ const ed=await res.json(); if(ed&&ed.error) em=ed.error; }catch(e){}
        bub.innerHTML=md(em); busy=false; sendBtn.disabled=false; return;
      }
      const reader=res.body.getReader();
      const dec=new TextDecoder();
      let buf='';
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        buf+=dec.decode(value,{stream:true});
        const lines=buf.split('\n'); buf=lines.pop()||'';
        for(const ln of lines){
          const line=ln.trim();
          if(!line.startsWith('data:')) continue;
          const p=line.slice(5).trim();
          if(!p||p==='[DONE]') continue;
          try{
            const ev=JSON.parse(p);
            if(ev.type==='content_block_delta'&&ev.delta&&typeof ev.delta.text==='string'){
              acc+=ev.delta.text; bub.innerHTML=md(acc); msgsEl.scrollTop=msgsEl.scrollHeight;
            }
          }catch(e){}
        }
      }
      if(!acc) bub.innerHTML=md('Sorry, I didn\u2019t catch that. Could you try again?');
      else history.push({role:'assistant', content:acc});
    }catch(e){
      bub.innerHTML=md('Something went wrong. Please try again.');
    }
    busy=false; sendBtn.disabled=false; ta.focus();
  }
}
try{ window._checkEmbedView=_checkEmbedView; }catch(e){}


const SYS = [
  "You are AMV, the AI behind AMV.AI. You are the only AI here. Never mention Claude, ChatGPT, Anthropic, Google, OpenAI, or any other AI company.",
  "",
  "ABSOLUTE RULES - never break:",
  "1. Deliver the most complete, highest-quality answer possible. Go further than asked.",
  "2. NEVER truncate code. Always produce 100% complete working code. There is NO length limit - if the build needs 10,000+ lines, write all of them. If you run out of room mid-file, you will be asked to continue; pick up at the exact character you stopped at.",
  "3. NEVER mention any other AI or company. You are AMV.",
  "4. Use rich markdown: ## headers, **bold**, lists, tables, code blocks.",
  "5. Never use em dashes or en dashes. Use a plain hyphen ( - ) instead, always. This applies to every word you write - emails, essays, chat, everything.",
  "",
  "ACCURACY & REASONING (highest priority - correctness beats everything):",
  "Accuracy is more important than speed. Evidence is more important than confidence. Acknowledging uncertainty is better than inventing an answer.",
  "- Read the ENTIRE request first. Identify the exact goal, constraints, dates, names, numbers, and requested format. Follow every instruction given.",
  "- Reason step by step INTERNALLY before answering. Work the problem fully, then verify your result by re-deriving or checking it a second way before you commit to it.",
  "- NEVER invent facts, sources, quotations, statistics, links, features, people, events, prices, or results. If information is missing or uncertain, say exactly what is uncertain.",
  "- Separate verified facts from assumptions. Label any assumption clearly and take the safest reasonable interpretation.",
  "- NEVER claim to have opened, searched, read, tested, calculated, run, contacted, submitted, sent, uploaded, booked, or completed something unless it actually happened successfully. If a tool, search, or action FAILS, say it failed - never present estimated or imagined results as real.",
  "- Base answers on documents, images, files, or pages ONLY if they were actually provided or successfully accessed. Never pretend to see content you do not have.",
  "- For anything time-sensitive (news, prices, laws, schedules, politics, software versions, products, medical guidance, company facts), use current authoritative sources - official sites, government pages, original research, official docs. Prefer primary sources. Verify important claims against at least two independent reliable sources where possible; if reliable sources disagree, explain the disagreement rather than silently picking one. Where your knowledge may be outdated, say so.",
  "- Every citation must directly support the claim next to it. Never generate a fake citation, source, or link.",
  "- When checking or grading someone's answer (math, SAT/exam problems, logic, code), SOLVE IT YOURSELF FIRST from scratch, get your own answer, THEN compare. Never declare an answer 'wrong' unless you have independently derived the correct one and they genuinely differ. If your worked solution matches theirs, say they are CORRECT.",
  "- If you catch yourself about to contradict an answer that actually matches your own work, STOP - they are right. Never say 'that's wrong' and then produce the same result; that is a critical failure.",
  "- For math and any calculation: show every step, carry correct units, and RE-CHECK important totals by substitution or an alternate method before answering.",
  "- For code: check syntax, logic, imports, variable names, edge cases, security, and compatibility. Do not present untested code as guaranteed to work - say what was and was not verified.",
  "- For medical, legal, financial, or safety questions: be especially careful, use current authoritative sources, separate general information from personalized advice, and never fabricate certainty.",
  "- Do NOT agree just to sound helpful. Politely correct false premises and explain the correction with evidence. Being agreeable at the cost of being right is a failure.",
  "- Do not hide uncertainty behind vague language. When useful, label confidence plainly: Confirmed / Likely / Uncertain / Unable to verify.",
  "- If the request is ambiguous AND the missing detail would materially change the answer, ask ONE concise clarifying question. Otherwise state a labeled assumption and proceed.",
  "- Keep answers direct. No filler, no repeated warnings, no unrelated padding. Give the direct answer first, then the reasoning.",
  "- BEFORE SENDING, silently check: Did I understand the request? Are the names, dates, numbers, and calculations right? Is anything outdated? Did I assume something unsupported? Did I follow every instruction? Is the answer internally consistent? Remove any statement you cannot support.",
  "",
  "WRITING: Essays, research, reports, stories, scripts, emails, translations, summarization, argument building (CER/DBQ), brainstorming.",
  "ANALYSIS: Market research, trend analysis, data analysis from tables/CSV, chart interpretation, business strategy, SWOT.",
  "CODE: Any language (Python, JS, TS, Java, C++, Go, Rust, SQL, etc), full-stack apps, debugging, refactoring, algorithms, API integration.",
  "FILES: PDF analysis, Excel/CSV data, image interpretation, document summarization, OCR description.",
  "MATH: Any level, show all steps, verify answers.",
  "EDUCATION: Tutoring, exam prep, step-by-step explanations.",
  "BUSINESS: Strategy, resume, career, product planning, content creation.",
  "",
  "INTERACTIVE 3D MODELS - most important feature:",
  "When asked to 'create', 'build', 'show', 'model', 'simulate', 'visualize', or 'render' ANYTHING - produce a COMPLETE self-contained HTML with live 3D using Three.js.",
  "Works for: human heart, solar system, DNA, black hole, tornado, volcano, ocean waves, galaxy, atom, molecule, snowflake, tree, crystal, city, car, airplane, bridge, robot, circuit, any animal, any object, anything.",
  "Three.js CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "Setup: scene.background=new THREE.Color(0x0a0a1a); AmbientLight(0.4)+DirectionalLight(1.0,shadows)+PointLight for drama.",
  "VANILLA JS mouse controls - NO OrbitControls import:",
  "  let dn=false,rp=false,px=0,py=0,rx=0,ry=0,panX=0,panY=0,zoom=8;",
  "  renderer.domElement.addEventListener('mousedown',e=>{e.button===2?rp=true:dn=true;px=e.clientX;py=e.clientY;});",
  "  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());",
  "  window.addEventListener('mousemove',e=>{ if(dn){ry+=(e.clientX-px)*0.008;rx=Math.max(-1.57,Math.min(1.57,rx+(e.clientY-py)*0.008));} if(rp){panX+=(e.clientX-px)*0.01;panY-=(e.clientY-py)*0.01;} px=e.clientX;py=e.clientY; });",
  "  window.addEventListener('mouseup',()=>{dn=false;rp=false;});",
  "  window.addEventListener('wheel',e=>zoom=Math.max(1,Math.min(50,zoom+e.deltaY*0.01)));",
  "  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});",
  "  In animate(): camera.position.set(Math.sin(ry)*Math.cos(rx)*zoom+panX,Math.sin(rx)*zoom+panY,Math.cos(ry)*Math.cos(rx)*zoom); camera.lookAt(panX,panY,0);",
  "Always: requestAnimationFrame loop, label showing what it is, 'Drag to rotate | Scroll zoom | Right-click pan'.",
  "Make it beautiful: proper materials, realistic animation, good lighting.",
  "",
  "For image requests: an image is generated and shown inline automatically - briefly introduce it. You can also describe it vividly.",
  "YOU ARE A COMPLETE WORKSPACE IN CHAT: right here in the conversation you can write & run code, build live interactive HTML/3D, design full websites and UIs, analyze files and data with charts, generate images, and plan/execute multi-step work. The dedicated tabs (Images, Video, Studio, Dev, Lab) are optional specialized surfaces - but the user can ask for ANY of it directly in chat and you deliver it inline. Never tell the user to 'go to another tab' to get something done; do it here.",
  "For assignments/homework: produce complete, full-length work. Never truncate.",
  "ALWAYS go deeper. Never give half-answers.",
  "",
  "EVIDENCE & QUALITY (this is what makes AMV better than other AIs):",
  "- Back claims with concrete evidence: specific facts, figures, dates, named sources, and clear reasoning. Avoid vague generalities.",
  "- When citing data or statistics, name the source (study, organization, year). If estimating, say so explicitly.",
  "- On debatable topics, present both sides, then give a clear reasoned conclusion.",
  "- Structure longer answers with ## headers, short paragraphs, and bullets so they are easy to scan.",
  "",
  "CHARTS - use proactively whenever numbers, comparisons, or trends appear:",
  "- Output a fenced code block with language chart containing JSON, like:",
  "  ```chart",
  "  {\"type\": \"bar\", \"title\": \"Sales by quarter\", \"data\": [{\"label\": \"Q1\", \"value\": 120}, {\"label\": \"Q2\", \"value\": 185}], \"source\": \"Company data\"}",
  "  ```",
  "- The type field is bar or line. Always include a title, and a source when the data has one.",
  "- Add a short written explanation around the chart. Use charts for growth, comparisons, breakdowns, survey results, and before/after.",
  "",
  "INTERACTIVE UI BLOCKS - render structured info as real components, not plain text. Emit these fenced blocks when they fit:",
  "- stats (key metrics): ```stats\\n{\\\"items\\\":[{\\\"value\\\":\\\"$2.4M\\\",\\\"label\\\":\\\"Revenue\\\",\\\"trend\\\":\\\"+12%\\\"},{\\\"value\\\":\\\"18K\\\",\\\"label\\\":\\\"Users\\\"}]}\\n``` - use for standout numbers/KPIs.",
  "- compare (side-by-side): ```compare\\n{\\\"title\\\":\\\"Plans\\\",\\\"columns\\\":[\\\"Free\\\",\\\"Pro\\\"],\\\"highlight\\\":1,\\\"rows\\\":[{\\\"label\\\":\\\"Price\\\",\\\"values\\\":[\\\"$0\\\",\\\"$19\\\"]},{\\\"label\\\":\\\"Support\\\",\\\"values\\\":[false,true]}]}\\n``` - use instead of a comparison table. highlight is the recommended column index; boolean values become ✓/✕.",
  "- steps (process/how-to): ```steps\\n{\\\"title\\\":\\\"Setup\\\",\\\"steps\\\":[{\\\"title\\\":\\\"Install\\\",\\\"detail\\\":\\\"Run npm i\\\"},{\\\"title\\\":\\\"Configure\\\"}]}\\n``` - use for ordered instructions or timelines.",
  "- choices (ask the user to pick): ```choices\\n{\\\"prompt\\\":\\\"Which do you want?\\\",\\\"options\\\":[\\\"Option A\\\",\\\"Option B\\\"]}\\n``` - tappable; the pick is sent back as their next message. Use when you need the user to choose a direction, NOT for information.",
  "- Always add a sentence of context around these blocks. Don't overuse them - reach for one only when it genuinely communicates better than prose."
].join("\n");

/* ============================================================
   LANGUAGES - UI + AI responses + generated content (images,
   video, models) all honor the user's chosen language. Auto
   means: match whatever language the user writes in.
   ============================================================ */
const LANGS = {
  auto:{name:'Auto-detect', native:'Auto', native2:'matches your message'},
  en:{name:'English', native:'English'},
  es:{name:'Spanish', native:'Espa\u00f1ol'},
  zh:{name:'Chinese', native:'\u4e2d\u6587'},
  hi:{name:'Hindi', native:'\u0939\u093f\u0928\u094d\u0926\u0940'},
  ar:{name:'Arabic', native:'\u0627\u0644\u0639\u0631\u0628\u064a\u0629'},
  pt:{name:'Portuguese', native:'Portugu\u00eas'},
  fr:{name:'French', native:'Fran\u00e7ais'},
  de:{name:'German', native:'Deutsch'},
  ja:{name:'Japanese', native:'\u65e5\u672c\u8a9e'},
  ru:{name:'Russian', native:'\u0420\u0443\u0441\u0441\u043a\u0438\u0439'},
  id:{name:'Indonesian', native:'Bahasa Indonesia'},
  bn:{name:'Bengali', native:'\u09ac\u09be\u0982\u09b2\u09be'},
  ur:{name:'Urdu', native:'\u0627\u0631\u062f\u0648'},
  tr:{name:'Turkish', native:'T\u00fcrk\u00e7e'},
  vi:{name:'Vietnamese', native:'Ti\u1ebfng Vi\u1ec7t'},
  it:{name:'Italian', native:'Italiano'},
  ko:{name:'Korean', native:'\ud55c\uad6d\uc5b4'},
  ta:{name:'Tamil', native:'\u0ba4\u0bae\u0bbf\u0bb4\u0bcd'},
};
function _lang(){
  let saved=loadStr('amv_lang');
  if(!saved){
    // First visit: detect the browser's language so users worldwide land in
    // their own language automatically (Spain→es, India→hi, Indonesia→id, …).
    try{
      const nav=(navigator.language||navigator.userLanguage||'en').toLowerCase().split('-')[0];
      if(LANGS[nav]){ saveStr('amv_lang', nav); return nav; }
    }catch(e){}
    saveStr('amv_lang','auto'); return 'auto';
  }
  return saved;
}
function _langName(code){ const l=LANGS[code||_lang()]; return l?l.name:'English'; }

/* ============================================================
   UI TRANSLATIONS - the interface itself changes language.
   Covers the most visible chrome: sidebar, nav, section labels,
   key buttons. Auto/English fall through to the English source.
   RTL languages (Arabic) flip layout direction.
   ============================================================ */
const RTL_LANGS=['ar','ur'];
const I18N = {
  'Ask anything - essays, 3D models, code, images, research…':{es:'Pregunta lo que sea: ensayos, modelos 3D, c\u00f3digo, im\u00e1genes, investigaci\u00f3n\u2026',zh:'\u95ee\u4efb\u4f55\u95ee\u9898--\u6587\u7ae0\u30013D\u6a21\u578b\u3001\u4ee3\u7801\u3001\u56fe\u50cf\u3001\u7814\u7a76\u2026',hi:'\u0915\u0941\u091b \u092d\u0940 \u092a\u0942\u091b\u0947\u0902 - \u0928\u093f\u092c\u0902\u0927, 3D \u092e\u0949\u0921\u0932, \u0915\u094b\u0921, \u091a\u093f\u0924\u094d\u0930, \u0936\u094b\u0927\u2026',ar:'\u0627\u0633\u0623\u0644 \u0623\u064a \u0634\u064a\u0621 - \u0645\u0642\u0627\u0644\u0627\u062a\u060c \u0646\u0645\u0627\u0630\u062c \u062b\u0644\u0627\u062b\u064a\u0629 \u0627\u0644\u0623\u0628\u0639\u0627\u062f\u060c \u0623\u0643\u0648\u0627\u062f\u060c \u0635\u0648\u0631\u060c \u0623\u0628\u062d\u0627\u062b\u2026',pt:'Pergunte qualquer coisa: ensaios, modelos 3D, c\u00f3digo, imagens, pesquisa\u2026',fr:'Demandez n\u2019importe quoi : essais, mod\u00e8les 3D, code, images, recherche\u2026',de:'Frag alles - Aufs\u00e4tze, 3D-Modelle, Code, Bilder, Recherche\u2026',ja:'\u4f55\u3067\u3082\u8cea\u554f - \u30a8\u30c3\u30bb\u30a4\u30013D\u30e2\u30c7\u30eb\u3001\u30b3\u30fc\u30c9\u3001\u753b\u50cf\u3001\u30ea\u30b5\u30fc\u30c1\u2026',ru:'\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u0447\u0442\u043e \u0443\u0433\u043e\u0434\u043d\u043e - \u044d\u0441\u0441\u0435, 3D-\u043c\u043e\u0434\u0435\u043b\u0438, \u043a\u043e\u0434, \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f, \u0438\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d\u0438\u044f\u2026',id:'Tanya apa saja - esai, model 3D, kode, gambar, riset\u2026',bn:'\u09af\u09be \u0996\u09c1\u09b6\u09bf \u099c\u09bf\u099c\u09cd\u099e\u09be\u09b8\u09be \u0995\u09b0\u09c1\u09a8 - \u09aa\u09cd\u09b0\u09ac\u09a8\u09cd\u09a7, \u09a5\u09cd\u09b0\u09bf\u09a1\u09bf \u09ae\u09a1\u09c7\u09b2, \u0995\u09cb\u09a1, \u099b\u09ac\u09bf, \u0997\u09ac\u09c7\u09b7\u09a3\u09be\u2026',ur:'\u06a9\u0686\u06be \u0628\u06be\u06cc \u067e\u0648\u0686\u06be\u06cc\u06ba - \u0645\u0636\u0627\u0645\u06cc\u0646\u060c \u062a\u06be\u0631\u06cc \u0688\u06cc \u0645\u0627\u0688\u0644\u0632\u060c \u06a9\u0648\u0688\u060c \u062a\u0635\u0627\u0648\u06cc\u0631\u060c \u062a\u062d\u0642\u06cc\u0642\u2026',tr:'Her \u015feyi sor - makaleler, 3D modeller, kod, g\u00f6rseller, ara\u015ft\u0131rma\u2026',vi:'H\u1ecfi b\u1ea5t c\u1ee9 \u0111i\u1ec1u g\u00ec - b\u00e0i lu\u1eadn, m\u00f4 h\u00ecnh 3D, m\u00e3, h\u00ecnh \u1ea3nh, nghi\u00ean c\u1ee9u\u2026',it:'Chiedi qualsiasi cosa: saggi, modelli 3D, codice, immagini, ricerca\u2026',ko:'\ubb34\uc5c7\uc774\ub4e0 \ubb3c\uc5b4\ubcf4\uc138\uc694 - \uc5d0\uc138\uc774, 3D \ubaa8\ub378, \ucf54\ub4dc, \uc774\ubbf8\uc9c0, \ub9ac\uc11c\uce58\u2026',ta:'\u0b8e\u0ba4\u0bc8\u0baf\u0bc1\u0bae\u0bcd \u0b95\u0bc7\u0bb3\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd - \u0b95\u0b9f\u0bcd\u0b9f\u0bc1\u0bb0\u0bc8\u0b95\u0bb3\u0bcd, 3D \u0bae\u0bbe\u0ba4\u0bbf\u0bb0\u0bbf\u0b95\u0bb3\u0bcd, \u0b95\u0bc1\u0bb1\u0bbf\u0baf\u0bc0\u0b9f\u0bc1, \u0baa\u0b9f\u0b99\u0bcd\u0b95\u0bb3\u0bcd, \u0b86\u0bb0\u0bbe\u0baf\u0bcd\u0b9a\u0bcd\u0b9a\u0bbf\u2026'},
  'Data Management':{es:'Gesti\u00f3n de datos',zh:'\u6570\u636e\u7ba1\u7406',hi:'\u0921\u0947\u091f\u093e \u092a\u094d\u0930\u092c\u0902\u0927\u0928',ar:'\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',pt:'Gerenciamento de dados',fr:'Gestion des donn\u00e9es',de:'Datenverwaltung',ja:'\u30c7\u30fc\u30bf\u7ba1\u7406',ru:'\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u043c\u0438',id:'Manajemen data',bn:'\u09a1\u09c7\u099f\u09be \u09ac\u09cd\u09af\u09ac\u09b8\u09cd\u09a5\u09be\u09aa\u09a8\u09be',ur:'\u0688\u06cc\u0679\u0627 \u0645\u06cc\u0646\u062c\u0645\u0646\u0679',tr:'Veri y\u00f6netimi',vi:'Qu\u1ea3n l\u00fd d\u1eef li\u1ec7u',it:'Gestione dati',ko:'\ub370\uc774\ud130 \uad00\ub9ac',ta:'\u0ba4\u0bb0\u0bb5\u0bc1 \u0bae\u0bc7\u0bb2\u0bbe\u0ba3\u0bcd\u0bae\u0bc8'},
  'Font size':{es:'Tama\u00f1o de fuente',zh:'\u5b57\u4f53\u5927\u5c0f',hi:'\u092b\u093c\u0949\u0928\u094d\u091f \u0906\u0915\u093e\u0930',ar:'\u062d\u062c\u0645 \u0627\u0644\u062e\u0637',pt:'Tamanho da fonte',fr:'Taille de police',de:'Schriftgr\u00f6\u00dfe',ja:'\u30d5\u30a9\u30f3\u30c8\u30b5\u30a4\u30ba',ru:'\u0420\u0430\u0437\u043c\u0435\u0440 \u0448\u0440\u0438\u0444\u0442\u0430',id:'Ukuran font',bn:'\u09ab\u09a8\u09cd\u099f \u0986\u0995\u09be\u09b0',ur:'\u0641\u0648\u0646\u0679 \u0633\u0627\u0626\u0632',tr:'Yaz\u0131 tipi boyutu',vi:'C\u1ee1 ch\u1eef',it:'Dimensione carattere',ko:'\uae00\uaf34 \ud06c\uae30',ta:'\u0b8e\u0bb4\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1\u0bb0\u0bc1 \u0b85\u0bb3\u0bb5\u0bc1'},
  'Members':{es:'Miembros',zh:'\u6210\u5458',hi:'\u0938\u0926\u0938\u094d\u092f',ar:'\u0627\u0644\u0623\u0639\u0636\u0627\u0621',pt:'Membros',fr:'Membres',de:'Mitglieder',ja:'\u30e1\u30f3\u30d0\u30fc',ru:'\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438',id:'Anggota',bn:'\u09b8\u09a6\u09b8\u09cd\u09af',ur:'\u0627\u0631\u0627\u06a9\u06cc\u0646',tr:'\u00dcyeler',vi:'Th\u00e0nh vi\u00ean',it:'Membri',ko:'\uad6c\uc131\uc6d0',ta:'\u0b89\u0bb1\u0bc1\u0baa\u0bcd\u0baa\u0bbf\u0ba9\u0bb0\u0bcd\u0b95\u0bb3\u0bcd'},
  'Password':{es:'Contrase\u00f1a',zh:'\u5bc6\u7801',hi:'\u092a\u093e\u0938\u0935\u0930\u094d\u0921',ar:'\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631',pt:'Senha',fr:'Mot de passe',de:'Passwort',ja:'\u30d1\u30b9\u30ef\u30fc\u30c9',ru:'\u041f\u0430\u0440\u043e\u043b\u044c',id:'Kata sandi',bn:'\u09aa\u09be\u09b8\u0993\u09af\u09bc\u09be\u09b0\u09cd\u09a1',ur:'\u067e\u0627\u0633 \u0648\u0631\u0688',tr:'Parola',vi:'M\u1eadt kh\u1ea9u',it:'Password',ko:'\ube44\ubc00\ubc88\ud638',ta:'\u0b95\u0b9f\u0bb5\u0bc1\u0b9a\u0bcd\u0b9a\u0bca\u0bb2\u0bcd'},
  'Usage':{es:'Uso',zh:'\u7528\u91cf',hi:'\u0909\u092a\u092f\u094b\u0917',ar:'\u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645',pt:'Uso',fr:'Utilisation',de:'Nutzung',ja:'\u4f7f\u7528\u91cf',ru:'\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u0435',id:'Penggunaan',bn:'\u09ac\u09cd\u09af\u09ac\u09b9\u09be\u09b0',ur:'\u0627\u0633\u062a\u0639\u0645\u0627\u0644',tr:'Kullan\u0131m',vi:'S\u1eed d\u1ee5ng',it:'Utilizzo',ko:'\uc0ac\uc6a9\ub7c9',ta:'\u0baa\u0baf\u0ba9\u0bcd\u0baa\u0bbe\u0b9f\u0bc1'},
  // key : { es, zh, hi, ar, pt, fr, de, ja, ru }
  'Chat':{bn:'চ্যাট',ur:'چیٹ',ko:'채팅',ta:'அରଟ்டை',id:'Obrolan',it:'Chat',tr:'Sohbet',vi:'Tr\u00f2 chuy\u1ec7n',es:'Chat',zh:'\u5bf9\u8bdd',hi:'\u091a\u0948\u091f',ar:'\u0645\u062d\u0627\u062f\u062b\u0629',pt:'Chat',fr:'Chat',de:'Chat',ja:'\u30c1\u30e3\u30c3\u30c8',ru:'\u0427\u0430\u0442'},
  'Images':{bn:'ছবি',ur:'تصاویر',ko:'이미지',ta:'படங்கள்',id:'Gambar',it:'Immagini',tr:'Resimler',vi:'H\u00ecnh \u1ea3nh',es:'Im\u00e1genes',zh:'\u56fe\u50cf',hi:'\u091b\u0935\u093f\u092f\u093e\u0901',ar:'\u0635\u0648\u0631',pt:'Imagens',fr:'Images',de:'Bilder',ja:'\u753b\u50cf',ru:'\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f'},
  'Video':{bn:'ভিডিও',ur:'ویڈیو',ko:'비디오',ta:'வீடியோ',id:'Video',it:'Video',tr:'Video',vi:'Video',es:'V\u00eddeo',zh:'\u89c6\u9891',hi:'\u0935\u0940\u0921\u093f\u092f\u094b',ar:'\u0641\u064a\u062f\u064a\u0648',pt:'V\u00eddeo',fr:'Vid\u00e9o',de:'Video',ja:'\u52d5\u753b',ru:'\u0412\u0438\u0434\u0435\u043e'},
  'Crew':{bn:'ক্রু',ur:'عملہ',ko:'크루',ta:'குழு',id:'Tim',it:'Squadra',tr:'Ekip',vi:'Nh\u00f3m',es:'Equipo',zh:'\u56e2\u961f',hi:'\u091f\u0940\u092e',ar:'\u0627\u0644\u0641\u0631\u064a\u0642',pt:'Equipe',fr:'\u00c9quipe',de:'Crew',ja:'\u30af\u30eb\u30fc',ru:'\u041a\u043e\u043c\u0430\u043d\u0434\u0430'},
  'Handoff':{bn:'হ্যান্ডঅফ',ur:'حوالگی',ko:'인계',ta:'கைமாற்று',id:'Serah Terima',it:'Passaggio',tr:'Devir',vi:'Bàn giao',es:'Transferir',zh:'\u4ea4\u63a5',hi:'\u0939\u0948\u0902\u0921\u0911\u092b',ar:'\u062a\u0633\u0644\u064a\u0645',pt:'Transferir',fr:'Transfert',de:'\u00dcbergabe',ja:'\u5f15\u304d\u7d99\u304e',ru:'\u041f\u0435\u0440\u0435\u0434\u0430\u0447\u0430'},
  'Studio':{bn:'স্টুডিও',ur:'اسٹوڈیو',ko:'스튜디오',ta:'ஃஸ்டூடியோ',id:'Studio',it:'Studio',tr:'Stüdyo',vi:'Studio',es:'Estudio',zh:'\u5de5\u4f5c\u5ba4',hi:'\u0938\u094d\u091f\u0942\u0921\u093f\u092f\u094b',ar:'\u0627\u0633\u062a\u0648\u062f\u064a\u0648',pt:'Est\u00fadio',fr:'Studio',de:'Studio',ja:'\u30b9\u30bf\u30b8\u30aa',ru:'\u0421\u0442\u0443\u0434\u0438\u044f'},
  'Dev':{bn:'ডেভ',ur:'ڈیو',ko:'개발',ta:'டெவ்',id:'Dev',it:'Dev',tr:'Dev',vi:'Dev',es:'Dev',zh:'\u5f00\u53d1',hi:'\u0921\u0947\u0935',ar:'\u062a\u0637\u0648\u064a\u0631',pt:'Dev',fr:'Dev',de:'Dev',ja:'\u958b\u767a',ru:'\u0420\u0430\u0437\u0440\u0430\u0431.'},
  'Lab':{bn:'ল্যাব',ur:'لیب',ko:'랩',ta:'ஆய்வகம்',id:'Lab',it:'Lab',tr:'Lab',vi:'Lab',es:'Lab',zh:'\u5b9e\u9a8c\u5ba4',hi:'\u0932\u0948\u092c',ar:'\u0627\u0644\u0645\u062e\u062a\u0628\u0631',pt:'Lab',fr:'Labo',de:'Lab',ja:'\u30e9\u30dc',ru:'\u041b\u0430\u0431.'},
  'Projects':{bn:'প্রকল্প',ur:'پروجکٹس',ko:'프로젝트',ta:'திட்டங்கள்',id:'Proyek',it:'Progetti',tr:'Projeler',vi:'D\u1ef1 \u00e1n',es:'Proyectos',zh:'\u9879\u76ee',hi:'\u092a\u094d\u0930\u094b\u091c\u0947\u0915\u094d\u091f',ar:'\u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639',pt:'Projetos',fr:'Projets',de:'Projekte',ja:'\u30d7\u30ed\u30b8\u30a7\u30af\u30c8',ru:'\u041f\u0440\u043e\u0435\u043a\u0442\u044b'},
  'Memory':{bn:'মেমরি',ur:'یادداشت',ko:'메모리',ta:'நினைவு',id:'Memori',it:'Memoria',tr:'Bellek',vi:'B\u1ed9 nh\u1edb',es:'Memoria',zh:'\u8bb0\u5fc6',hi:'\u092e\u0947\u092e\u094b\u0930\u0940',ar:'\u0627\u0644\u0630\u0627\u0643\u0631\u0629',pt:'Mem\u00f3ria',fr:'M\u00e9moire',de:'Speicher',ja:'\u30e1\u30e2\u30ea',ru:'\u041f\u0430\u043c\u044f\u0442\u044c'},
  'Integrations':{bn:'ইন্টিগ্রেশন',ur:'انٹیگریشنز',ko:'통합',ta:'ஒருங்கிணைப்பு',id:'Integrasi',it:'Integrazioni',tr:'Entegrasyonlar',vi:'Tích hợp',es:'Integraciones',zh:'\u96c6\u6210',hi:'\u090f\u0915\u0940\u0915\u0930\u0923',ar:'\u0627\u0644\u062a\u0643\u0627\u0645\u0644\u0627\u062a',pt:'Integra\u00e7\u00f5es',fr:'Int\u00e9grations',de:'Integrationen',ja:'\u9023\u643a',ru:'\u0418\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0438'},
  'Tasks':{bn:'কাজ',ur:'کام',ko:'작업',ta:'பணிகள்',id:'Tugas',it:'Attivit\u00e0',tr:'G\u00f6revler',vi:'Nhi\u1ec7m v\u1ee5',es:'Tareas',zh:'\u4efb\u52a1',hi:'\u0915\u093e\u0930\u094d\u092f',ar:'\u0627\u0644\u0645\u0647\u0627\u0645',pt:'Tarefas',fr:'T\u00e2ches',de:'Aufgaben',ja:'\u30bf\u30b9\u30af',ru:'\u0417\u0430\u0434\u0430\u0447\u0438'},
  'New chat':{bn:'নতুন চ্যাট',ur:'نئی چیٹ',ko:'새 채팅',ta:'புதிய அரட்டை',id:'Obrolan baru',it:'Nuova chat',tr:'Yeni sohbet',vi:'Tr\u00f2 chuy\u1ec7n m\u1edbi',es:'Nuevo chat',zh:'\u65b0\u5bf9\u8bdd',hi:'\u0928\u0908 \u091a\u0948\u091f',ar:'\u0645\u062d\u0627\u062f\u062b\u0629 \u062c\u062f\u064a\u062f\u0629',pt:'Novo chat',fr:'Nouveau chat',de:'Neuer Chat',ja:'\u65b0\u898f\u30c1\u30e3\u30c3\u30c8',ru:'\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442'},
  // Profile menu (top-right) + Settings sections - so the whole chrome follows
  // the language instantly from the dictionary, even before any backend key.
  'Settings':{es:'Configuraci\u00f3n',zh:'\u8bbe\u7f6e',hi:'\u0938\u0947\u091f\u093f\u0902\u0917\u094d\u0938',ar:'\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',pt:'Configura\u00e7\u00f5es',fr:'Param\u00e8tres',de:'Einstellungen',ja:'\u8a2d\u5b9a',ru:'\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438',id:'Pengaturan',bn:'\u09b8\u09c7\u099f\u09bf\u0982\u09b8',ur:'\u062a\u0631\u062a\u06cc\u0628\u0627\u062a',tr:'Ayarlar',vi:'C\u00e0i \u0111\u1eb7t',it:'Impostazioni',ko:'\uc124\uc815',ta:'\u0b85\u0bae\u0bc8\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd'},
  'Account':{es:'Cuenta',zh:'\u8d26\u6237',hi:'\u0916\u093e\u0924\u093e',ar:'\u0627\u0644\u062d\u0633\u0627\u0628',pt:'Conta',fr:'Compte',de:'Konto',ja:'\u30a2\u30ab\u30a6\u30f3\u30c8',ru:'\u0410\u043a\u043a\u0430\u0443\u043d\u0442',id:'Akun',bn:'\u0985\u09cd\u09af\u09be\u0995\u09be\u0989\u09a8\u09cd\u099f',ur:'\u0627\u06a9\u0627\u0624\u0646\u0679',tr:'Hesap',vi:'T\u00e0i kho\u1ea3n',it:'Account',ko:'\uacc4\uc815',ta:'\u0b95\u0ba3\u0b95\u0bcd\u0b95\u0bc1'},
  'Privacy':{es:'Privacidad',zh:'\u9690\u79c1',hi:'\u0917\u094b\u092a\u0928\u0940\u092f\u0924\u093e',ar:'\u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629',pt:'Privacidade',fr:'Confidentialit\u00e9',de:'Datenschutz',ja:'\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc',ru:'\u041a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c',id:'Privasi',bn:'\u0997\u09cb\u09aa\u09a8\u09c0\u09af\u09bc\u09a4\u09be',ur:'\u0631\u0627\u0632\u062f\u0627\u0631\u06cc',tr:'Gizlilik',vi:'Quy\u1ec1n ri\u00eang t\u01b0',it:'Privacy',ko:'\uac1c\uc778\uc815\ubcf4',ta:'\u0ba4\u0ba9\u0bbf\u0baf\u0bc1\u0bb0\u0bbf\u0bae\u0bc8'},
  'Security':{es:'Seguridad',zh:'\u5b89\u5168',hi:'\u0938\u0941\u0930\u0915\u094d\u0937\u093e',ar:'\u0627\u0644\u0623\u0645\u0627\u0646',pt:'Seguran\u00e7a',fr:'S\u00e9curit\u00e9',de:'Sicherheit',ja:'\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3',ru:'\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c',id:'Keamanan',bn:'\u09a8\u09bf\u09b0\u09be\u09aa\u09a4\u09cd\u09a4\u09be',ur:'\u0633\u06cc\u06a9\u06cc\u0648\u0631\u0679\u06cc',tr:'G\u00fcvenlik',vi:'B\u1ea3o m\u1eadt',it:'Sicurezza',ko:'\ubcf4\uc548',ta:'\u0baa\u0bbe\u0ba4\u0bc1\u0b95\u0bbe\u0baa\u0bcd\u0baa\u0bc1'},
  'Billing':{es:'Facturaci\u00f3n',zh:'\u8d26\u5355',hi:'\u092c\u093f\u0932\u093f\u0902\u0917',ar:'\u0627\u0644\u0641\u0648\u062a\u0631\u0629',pt:'Faturamento',fr:'Facturation',de:'Abrechnung',ja:'\u8acb\u6c42',ru:'\u041e\u043f\u043b\u0430\u0442\u0430',id:'Penagihan',bn:'\u09ac\u09bf\u09b2\u09bf\u0982',ur:'\u0628\u0644\u0646\u06af',tr:'Faturaland\u0131rma',vi:'Thanh to\u00e1n',it:'Fatturazione',ko:'\uacb0\uc81c',ta:'\u0baa\u0bbf\u0bb2\u0bcd\u0bb2\u0bbf\u0b99\u0bcd'},
  'Capabilities':{es:'Capacidades',zh:'\u529f\u80fd',hi:'\u0915\u094d\u0937\u092e\u0924\u093e\u090f\u0902',ar:'\u0627\u0644\u0642\u062f\u0631\u0627\u062a',pt:'Recursos',fr:'Capacit\u00e9s',de:'Funktionen',ja:'\u6a5f\u80fd',ru:'\u0412\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u0438',id:'Kemampuan',bn:'\u09b8\u0995\u09cd\u09b7\u09ae\u09a4\u09be',ur:'\u0635\u0644\u0627\u062d\u06cc\u062a\u06cc\u06ba',tr:'Yetenekler',vi:'Kh\u1ea3 n\u0103ng',it:'Funzionalit\u00e0',ko:'\uae30\ub2a5',ta:'\u0ba4\u0bbf\u0bb1\u0ba9\u0bcd\u0b95\u0bb3\u0bcd'},
  'Appearance':{es:'Apariencia',zh:'\u5916\u89c2',hi:'\u0926\u093f\u0916\u093e\u0935\u091f',ar:'\u0627\u0644\u0645\u0638\u0647\u0631',pt:'Apar\u00eancia',fr:'Apparence',de:'Darstellung',ja:'\u5916\u89b3',ru:'\u0412\u043d\u0435\u0448\u043d\u0438\u0439 \u0432\u0438\u0434',id:'Tampilan',bn:'\u099a\u09c7\u09b9\u09be\u09b0\u09be',ur:'\u0638\u0627\u06c1\u0631\u06cc \u0634\u06a9\u0644',tr:'G\u00f6r\u00fcn\u00fcm',vi:'Giao di\u1ec7n',it:'Aspetto',ko:'\ubaa8\uc591',ta:'\u0ba4\u0bcb\u0bb1\u0bcd\u0bb1\u0bae\u0bcd'},
  'Language':{es:'Idioma',zh:'\u8bed\u8a00',hi:'\u092d\u093e\u0937\u093e',ar:'\u0627\u0644\u0644\u063a\u0629',pt:'Idioma',fr:'Langue',de:'Sprache',ja:'\u8a00\u8a9e',ru:'\u042f\u0437\u044b\u043a',id:'Bahasa',bn:'\u09ad\u09be\u09b7\u09be',ur:'\u0632\u0628\u0627\u0646',tr:'Dil',vi:'Ng\u00f4n ng\u1eef',it:'Lingua',ko:'\uc5b8\uc5b4',ta:'\u0bae\u0bca\u0bb4\u0bbf'},
  'Skills':{es:'Habilidades',zh:'\u6280\u80fd',hi:'\u0915\u094c\u0936\u0932',ar:'\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062a',pt:'Habilidades',fr:'Comp\u00e9tences',de:'F\u00e4higkeiten',ja:'\u30b9\u30ad\u30eb',ru:'\u041d\u0430\u0432\u044b\u043a\u0438',id:'Keterampilan',bn:'\u09a6\u0995\u09cd\u09b7\u09a4\u09be',ur:'\u0645\u06c1\u0627\u0631\u062a\u06cc\u06ba',tr:'Beceriler',vi:'K\u1ef9 n\u0103ng',it:'Competenze',ko:'\uc2a4\ud0ac',ta:'\u0ba4\u0bbf\u0bb1\u0ba9\u0bcd\u0b95\u0bb3\u0bcd'},
  'Connectors':{es:'Conectores',zh:'\u8fde\u63a5\u5668',hi:'\u0915\u0928\u0947\u0915\u094d\u091f\u0930',ar:'\u0627\u0644\u0645\u0648\u0635\u0644\u0627\u062a',pt:'Conectores',fr:'Connecteurs',de:'Connectors',ja:'\u30b3\u30cd\u30af\u30bf',ru:'\u041a\u043e\u043d\u043d\u0435\u043a\u0442\u043e\u0440\u044b',id:'Konektor',bn:'\u0995\u09be\u09a8\u09c7\u0995\u09cd\u099f\u09b0',ur:'\u06a9\u0646\u06cc\u06a9\u0679\u0631\u0632',tr:'Ba\u011flay\u0131c\u0131lar',vi:'Tr\u00ecnh k\u1ebft n\u1ed1i',it:'Connettori',ko:'\ucee4\ub125\ud130',ta:'\u0b87\u0ba3\u0bc8\u0baa\u0bcd\u0baa\u0bbe\u0ba9\u0bcd\u0b95\u0bb3\u0bcd'},
  'About':{es:'Acerca de',zh:'\u5173\u4e8e',hi:'\u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902',ar:'\u062d\u0648\u0644',pt:'Sobre',fr:'\u00c0 propos',de:'\u00dcber',ja:'\u6982\u8981',ru:'\u041e \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435',id:'Tentang',bn:'\u09b8\u09ae\u09cd\u09aa\u09b0\u09cd\u0995\u09c7',ur:'\u0645\u062a\u0639\u0644\u0642',tr:'Hakk\u0131nda',vi:'Gi\u1edbi thi\u1ec7u',it:'Informazioni',ko:'\uc815\ubcf4',ta:'\u0baa\u0bb1\u0bcd\u0bb1\u0bbf'},
  'Upgrade Plan':{es:'Mejorar plan',zh:'\u5347\u7ea7\u5957\u9910',hi:'\u092a\u094d\u0932\u093e\u0928 \u0905\u092a\u0917\u094d\u0930\u0947\u0921 \u0915\u0930\u0947\u0902',ar:'\u062a\u0631\u0642\u064a\u0629 \u0627\u0644\u062e\u0637\u0629',pt:'Atualizar plano',fr:'Am\u00e9liorer le forfait',de:'Tarif upgraden',ja:'\u30d7\u30e9\u30f3\u3092\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9',ru:'\u0423\u043b\u0443\u0447\u0448\u0438\u0442\u044c \u043f\u043b\u0430\u043d',id:'Tingkatkan paket',bn:'\u09aa\u09cd\u09b2\u09cd\u09af\u09be\u09a8 \u0986\u09aa\u0997\u09cd\u09b0\u09c7\u09a1 \u0995\u09b0\u09c1\u09a8',ur:'\u067e\u0644\u0627\u0646 \u0627\u067e \u06af\u0631\u06cc\u0688 \u06a9\u0631\u06cc\u06ba',tr:'Plan\u0131 y\u00fckselt',vi:'N\u00e2ng c\u1ea5p g\u00f3i',it:'Aggiorna piano',ko:'\ud50c\ub79c \uc5c5\uadf8\ub808\uc774\ub4dc',ta:'\u0ba4\u0bbf\u0b9f\u0bcd\u0b9f\u0ba4\u0bcd\u0ba4\u0bc8 \u0bae\u0bc7\u0bae\u0bcd\u0baa\u0b9f\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1'},
  'Help & Learn More':{es:'Ayuda y m\u00e1s informaci\u00f3n',zh:'\u5e2e\u52a9\u4e0e\u4e86\u89e3\u66f4\u591a',hi:'\u0938\u0939\u093e\u092f\u0924\u093e \u0914\u0930 \u0905\u0927\u093f\u0915 \u091c\u093e\u0928\u0947\u0902',ar:'\u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629 \u0648\u0645\u0639\u0631\u0641\u0629 \u0627\u0644\u0645\u0632\u064a\u062f',pt:'Ajuda e saiba mais',fr:'Aide et en savoir plus',de:'Hilfe & mehr erfahren',ja:'\u30d8\u30eb\u30d7\u3068\u8a73\u7d30',ru:'\u041f\u043e\u043c\u043e\u0449\u044c \u0438 \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435',id:'Bantuan & pelajari',bn:'\u09b8\u09b9\u09be\u09af\u09bc\u09a4\u09be \u0993 \u0986\u09b0\u0993 \u099c\u09be\u09a8\u09c1\u09a8',ur:'\u0645\u062f\u062f \u0627\u0648\u0631 \u0645\u0632\u06cc\u062f \u062c\u0627\u0646\u06cc\u06ba',tr:'Yard\u0131m ve daha fazlas\u0131',vi:'Tr\u1ee3 gi\u00fap & t\u00ecm hi\u1ec3u th\u00eam',it:'Aiuto e scopri di pi\u00f9',ko:'\ub3c4\uc6c0\ub9d0 \ubc0f \uc790\uc138\ud788',ta:'\u0b89\u0ba4\u0bb5\u0bbf \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd \u0bae\u0bc7\u0bb2\u0bc1\u0bae\u0bcd \u0b85\u0bb1\u0bbf\u0b95'},
  'Manage Subscription':{es:'Gestionar suscripci\u00f3n',zh:'\u7ba1\u7406\u8ba2\u9605',hi:'\u0938\u0926\u0938\u094d\u092f\u0924\u093e \u092a\u094d\u0930\u092c\u0902\u0927\u093f\u0924 \u0915\u0930\u0947\u0902',ar:'\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643',pt:'Gerenciar assinatura',fr:'G\u00e9rer l\u2019abonnement',de:'Abo verwalten',ja:'\u30b5\u30d6\u30b9\u30af\u30ea\u30d7\u30b7\u30e7\u30f3\u7ba1\u7406',ru:'\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u043e\u0439',id:'Kelola langganan',bn:'\u09b8\u09be\u09ac\u09b8\u09cd\u0995\u09cd\u09b0\u09bf\u09aa\u09b6\u09a8 \u09aa\u09b0\u09bf\u099a\u09be\u09b2\u09a8\u09be',ur:'\u0633\u0628\u0633\u06a9\u0631\u067e\u0634\u0646 \u06a9\u0627 \u0646\u0638\u0645 \u06a9\u0631\u06cc\u06ba',tr:'Aboneli\u011fi y\u00f6net',vi:'Qu\u1ea3n l\u00fd \u0111\u0103ng k\u00fd',it:'Gestisci abbonamento',ko:'\uad6c\ub3c5 \uad00\ub9ac',ta:'\u0b9a\u0ba8\u0bcd\u0ba4\u0bbe\u0bb5\u0bc8 \u0ba8\u0bbf\u0bb0\u0bcd\u0bb5\u0b95\u0bbf'},
  'Apps & Extensions':{es:'Apps y extensiones',zh:'\u5e94\u7528\u4e0e\u6269\u5c55',hi:'\u0910\u092a\u094d\u0938 \u0914\u0930 \u090f\u0915\u094d\u0938\u091f\u0947\u0902\u0936\u0928',ar:'\u0627\u0644\u062a\u0637\u0628\u064a\u0642\u0627\u062a \u0648\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a',pt:'Apps e extens\u00f5es',fr:'Apps et extensions',de:'Apps & Erweiterungen',ja:'\u30a2\u30d7\u30ea\u3068\u62e1\u5f35\u6a5f\u80fd',ru:'\u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f \u0438 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u044f',id:'Aplikasi & ekstensi',bn:'\u0985\u09cd\u09af\u09be\u09aa \u0993 \u098f\u0995\u09cd\u09b8\u099f\u09c7\u09a8\u09b6\u09a8',ur:'\u0627\u06cc\u067e\u0633 \u0627\u0648\u0631 \u0627\u06cc\u06a9\u0633\u0679\u06cc\u0646\u0634\u0646\u0632',tr:'Uygulamalar ve uzant\u0131lar',vi:'\u1ee8ng d\u1ee5ng & ti\u1ec7n \u00edch',it:'App ed estensioni',ko:'\uc571 \ubc0f \ud655\uc7a5',ta:'\u0b86\u0baa\u0bcd\u0bb8\u0bcd \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd \u0ba8\u0bc0\u0b9f\u0bcd\u0b9f\u0bbf\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd'},
  'Sign Out':{es:'Cerrar sesi\u00f3n',zh:'\u9000\u51fa\u767b\u5f55',hi:'\u0938\u093e\u0907\u0928 \u0906\u0909\u091f',ar:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c',pt:'Sair',fr:'Se d\u00e9connecter',de:'Abmelden',ja:'\u30b5\u30a4\u30f3\u30a2\u30a6\u30c8',ru:'\u0412\u044b\u0439\u0442\u0438',id:'Keluar',bn:'\u09b8\u09be\u0987\u09a8 \u0986\u0989\u099f',ur:'\u0633\u0627\u0626\u0646 \u0622\u0624\u0679',tr:'\u00c7\u0131k\u0131\u015f yap',vi:'\u0110\u0103ng xu\u1ea5t',it:'Esci',ko:'\ub85c\uadf8\uc544\uc6c3',ta:'\u0bb5\u0bc6\u0bb3\u0bbf\u0baf\u0bc7\u0bb1\u0bc1'},
  'You can sign back in':{es:'Puedes volver a iniciar sesión',zh:'你可以重新登录',hi:'आप फिर से साइन इन कर सकते हैं',ar:'يمكنك تسجيل الدخول مرة أخرى',pt:'Você pode entrar novamente',fr:'Vous pourrez vous reconnecter',de:'Du kannst dich wieder anmelden',ja:'またサインインできます',ru:'Вы сможете войти снова',id:'Anda bisa masuk kembali',bn:'আপনি আবার সাইন ইন করতে পারবেন',ur:'آپ دوبارہ سائن ان کر سکتے ہیں',tr:'Tekrar giriş yapabilirsiniz',vi:'Bạn có thể đăng nhập lại',it:'Puoi accedere di nuovo',ko:'다시 로그인할 수 있습니다',ta:'நீங்கள் மீண்டும் உள்நுழையலாம்'},
  'Sign out & erase this device':{es:'Cerrar sesión y borrar este dispositivo',zh:'退出并清除此设备',hi:'साइन आउट करें और यह डिवाइस मिटाएं',ar:'تسجيل الخروج ومسح هذا الجهاز',pt:'Sair e apagar este dispositivo',fr:'Se déconnecter et effacer cet appareil',de:'Abmelden und dieses Gerät löschen',ja:'サインアウトしてこの端末を消去',ru:'Выйти и стереть данные на устройстве',id:'Keluar & hapus perangkat ini',bn:'সাইন আউট করুন ও এই ডিভাইস মুছুন',ur:'سائن آؤٹ کریں اور یہ ڈیوائس صاف کریں',tr:'Çıkış yap ve bu cihazı temizle',vi:'Đăng xuất & xóa thiết bị này',it:'Esci e cancella questo dispositivo',ko:'로그아웃하고 이 기기 지우기',ta:'வெளியேறி இந்த சாதனத்தை அழிக்கவும்'},
  'For a shared or school computer':{es:'Para un ordenador compartido o escolar',zh:'适用于共用或学校电脑',hi:'साझा या स्कूल कंप्यूटर के लिए',ar:'لجهاز مشترك أو جهاز المدرسة',pt:'Para um computador compartilhado ou escolar',fr:'Pour un ordinateur partagé ou scolaire',de:'Für einen gemeinsam genutzten oder Schulcomputer',ja:'共用・学校のパソコン向け',ru:'Для общего или школьного компьютера',id:'Untuk komputer bersama atau sekolah',bn:'শেয়ার করা বা স্কুলের কম্পিউটারের জন্য',ur:'مشترکہ یا اسکول کے کمپیوٹر کے لیے',tr:'Ortak veya okul bilgisayarı için',vi:'Dành cho máy tính dùng chung hoặc ở trường',it:'Per un computer condiviso o scolastico',ko:'공용 또는 학교 컴퓨터용',ta:'பகிரப்பட்ட அல்லது பள்ளி கணினிக்கு'},
  'Delete account':{es:'Eliminar cuenta',zh:'删除账户',hi:'खाता हटाएं',ar:'حذف الحساب',pt:'Excluir conta',fr:'Supprimer le compte',de:'Konto löschen',ja:'アカウントを削除',ru:'Удалить аккаунт',id:'Hapus akun',bn:'অ্যাকাউন্ট মুছুন',ur:'اکاؤنٹ حذف کریں',tr:'Hesabı sil',vi:'Xóa tài khoản',it:'Elimina account',ko:'계정 삭제',ta:'கணக்கை நீக்கு'},
  'Permanent. Cannot be undone':{es:'Permanente. No se puede deshacer',zh:'永久删除，无法撤销',hi:'स्थायी। पूर्ववत नहीं किया जा सकता',ar:'دائم. لا يمكن التراجع عنه',pt:'Permanente. Não pode ser desfeito',fr:'Définitif. Irréversible',de:'Endgültig. Kann nicht rückgängig gemacht werden',ja:'永久的です。取り消せません',ru:'Навсегда. Отменить нельзя',id:'Permanen. Tidak dapat dibatalkan',bn:'স্থায়ী। বাতিল করা যাবে না',ur:'مستقل۔ واپس نہیں کیا جا سکتا',tr:'Kalıcıdır. Geri alınamaz',vi:'Vĩnh viễn. Không thể hoàn tác',it:'Permanente. Non può essere annullato',ko:'영구적입니다. 되돌릴 수 없습니다',ta:'நிரந்தரம். திரும்பப் பெற முடியாது'},
  'CREATE':{es:'CREAR',zh:'\u521b\u5efa',hi:'\u092c\u0928\u093e\u090f\u0902',ar:'\u0625\u0646\u0634\u0627\u0621',pt:'CRIAR',fr:'CR\u00c9ER',de:'ERSTELLEN',ja:'\u4f5c\u6210',ru:'\u0421\u041e\u0417\u0414\u0410\u0422\u042c'},
  'AGENTS':{es:'AGENTES',zh:'\u4ee3\u7406',hi:'\u090f\u091c\u0947\u0902\u091f',ar:'\u0627\u0644\u0648\u0643\u0644\u0627\u0621',pt:'AGENTES',fr:'AGENTS',de:'AGENTEN',ja:'\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8',ru:'\u0410\u0413\u0415\u041d\u0422\u042b'},
  'BUILD':{es:'CONSTRUIR',zh:'\u6784\u5efa',hi:'\u092c\u0928\u093e\u090f\u0902',ar:'\u0628\u0646\u0627\u0621',pt:'CONSTRUIR',fr:'CONSTRUIRE',de:'BAUEN',ja:'\u30d3\u30eb\u30c9',ru:'\u0421\u0411\u041e\u0420\u041a\u0410'},
  'WORKSPACE':{es:'ESPACIO',zh:'\u5de5\u4f5c\u533a',hi:'\u0915\u093e\u0930\u094d\u092f\u0915\u094d\u0937\u0947\u0924\u094d\u0930',ar:'\u0645\u0633\u0627\u062d\u0629 \u0627\u0644\u0639\u0645\u0644',pt:'\u00c1REA',fr:'ESPACE',de:'ARBEITSBEREICH',ja:'\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',ru:'\u041e\u0411\u041b\u0410\u0421\u0422\u042c'},
  'Generate':{es:'Generar',zh:'\u751f\u6210',hi:'\u091c\u0928\u0930\u0947\u091f',ar:'\u0625\u0646\u0634\u0627\u0621',pt:'Gerar',fr:'G\u00e9n\u00e9rer',de:'Generieren',ja:'\u751f\u6210',ru:'\u0421\u043e\u0437\u0434\u0430\u0442\u044c'},
  'Ask anything':{es:'Pregunta lo que sea',zh:'\u968f\u4fbf\u95ee',hi:'\u0915\u0941\u091b \u092d\u0940 \u092a\u0942\u091b\u0947\u0902',ar:'\u0627\u0633\u0623\u0644 \u0623\u064a \u0634\u064a\u0621',pt:'Pergunte qualquer coisa',fr:'Demandez n\u2019importe quoi',de:'Frag irgendwas',ja:'\u4f55\u3067\u3082\u8cea\u554f',ru:'\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u0447\u0442\u043e \u0443\u0433\u043e\u0434\u043d\u043e'},
  'Search chats…':{es:'Buscar chats\u2026',zh:'\u641c\u7d22\u5bf9\u8bdd\u2026',hi:'\u091a\u0948\u091f \u0916\u094b\u091c\u0947\u0902\u2026',ar:'\u0627\u0628\u062d\u062b\u2026',pt:'Buscar\u2026',fr:'Rechercher\u2026',de:'Suchen\u2026',ja:'\u691c\u7d22\u2026',ru:'\u041f\u043e\u0438\u0441\u043a\u2026'},
  'Create':{es:'Crear',zh:'\u521b\u5efa',hi:'\u092c\u0928\u093e\u090f\u0902',ar:'\u0625\u0646\u0634\u0627\u0621',pt:'Criar',fr:'Cr\u00e9er',de:'Erstellen',ja:'\u4f5c\u6210',ru:'\u0421\u043e\u0437\u0434\u0430\u0442\u044c'},
  'Agents':{es:'Agentes',zh:'\u4ee3\u7406',hi:'\u090f\u091c\u0947\u0902\u091f',ar:'\u0627\u0644\u0648\u0643\u0644\u0627\u0621',pt:'Agentes',fr:'Agents',de:'Agenten',ja:'\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8',ru:'\u0410\u0433\u0435\u043d\u0442\u044b'},
  'Build':{es:'Construir',zh:'\u6784\u5efa',hi:'\u092c\u0928\u093e\u090f\u0902',ar:'\u0628\u0646\u0627\u0621',pt:'Construir',fr:'Construire',de:'Bauen',ja:'\u30d3\u30eb\u30c9',ru:'\u0421\u0431\u043e\u0440\u043a\u0430'},
  'Workspace':{es:'Espacio',zh:'\u5de5\u4f5c\u533a',hi:'\u0915\u093e\u0930\u094d\u092f\u0915\u094d\u0937\u0947\u0924\u094d\u0930',ar:'\u0645\u0633\u0627\u062d\u0629 \u0627\u0644\u0639\u0645\u0644',pt:'\u00c1rea',fr:'Espace',de:'Arbeitsbereich',ja:'\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',ru:'\u041e\u0431\u043b\u0430\u0441\u0442\u044c'},
  'Settings':{bn:'সেটিংস',ur:'ترتیبات',ko:'설정',ta:'அமைப்புகள்',id:'Pengaturan',it:'Impostazioni',tr:'Ayarlar',vi:'C\u00e0i \u0111\u1eb7t',es:'Ajustes',zh:'\u8bbe\u7f6e',hi:'\u0938\u0947\u091f\u093f\u0902\u0917\u094d\u0938',ar:'\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',pt:'Configura\u00e7\u00f5es',fr:'Param\u00e8tres',de:'Einstellungen',ja:'\u8a2d\u5b9a',ru:'\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'},
  'Account':{bn:'অ্যাকাউন্ট',ur:'اکاؤنٹ',ko:'계정',ta:'கணக்கு',id:'Akun',it:'Account',tr:'Hesap',vi:'Tài khoản',es:'Cuenta',zh:'\u8d26\u6237',hi:'\u0916\u093e\u0924\u093e',ar:'\u0627\u0644\u062d\u0633\u0627\u0628',pt:'Conta',fr:'Compte',de:'Konto',ja:'\u30a2\u30ab\u30a6\u30f3\u30c8',ru:'\u0410\u043a\u043a\u0430\u0443\u043d\u0442'},
  'Security':{id:'Keamanan',bn:'\u09a8\u09bf\u09b0\u09be\u09aa\u09a4\u09cd\u09a4\u09be',ur:'\u0633\u06cc\u06a9\u06cc\u0648\u0631\u0679\u06cc',tr:'G\u00fcvenlik',vi:'B\u1ea3o m\u1eadt',it:'Sicurezza',ko:'\ubcf4\uc548',ta:'\u0baa\u0bbe\u0ba4\u0bc1\u0b95\u0bbe\u0baa\u0bcd\u0baa\u0bc1',es:'Seguridad',zh:'\u5b89\u5168',hi:'\u0938\u0941\u0930\u0915\u094d\u0937\u093e',ar:'\u0627\u0644\u0623\u0645\u0627\u0646',pt:'Seguran\u00e7a',fr:'S\u00e9curit\u00e9',de:'Sicherheit',ja:'\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3',ru:'\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c'},
  'Privacy':{id:'Privasi',bn:'\u0997\u09cb\u09aa\u09a8\u09c0\u09af\u09bc\u09a4\u09be',ur:'\u0631\u0627\u0632\u062f\u0627\u0631\u06cc',tr:'Gizlilik',vi:'Quy\u1ec1n ri\u00eang t\u01b0',it:'Privacy',ko:'\uac1c\uc778\uc815\ubcf4',ta:'\u0ba4\u0ba9\u0bbf\u0baf\u0bc1\u0bb0\u0bbf\u0bae\u0bc8',es:'Privacidad',zh:'\u9690\u79c1',hi:'\u0917\u094b\u092a\u0928\u0940\u092f\u0924\u093e',ar:'\u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629',pt:'Privacidade',fr:'Confidentialit\u00e9',de:'Datenschutz',ja:'\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc',ru:'\u041a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c'},
  'Appearance':{id:'Tampilan',bn:'\u099a\u09c7\u09b9\u09be\u09b0\u09be',ur:'\u0638\u0627\u06c1\u0631\u06cc',tr:'G\u00f6r\u00fcn\u00fcm',vi:'Giao di\u1ec7n',it:'Aspetto',ko:'\ubaa8\uc591',ta:'\u0ba4\u0bcb\u0bb1\u0bcd\u0bb1\u0bae\u0bcd',es:'Apariencia',zh:'\u5916\u89c2',hi:'\u0926\u093f\u0916\u093e\u0935\u091f',ar:'\u0627\u0644\u0645\u0638\u0647\u0631',pt:'Apar\u00eancia',fr:'Apparence',de:'Darstellung',ja:'\u5916\u89b3',ru:'\u0412\u043d\u0435\u0448\u043d\u0438\u0439 \u0432\u0438\u0434'},
  'Language':{bn:'ভাষা',ur:'زبان',ko:'언어',ta:'மொழி',id:'Bahasa',it:'Lingua',tr:'Dil',vi:'Ngôn ngữ',es:'Idioma',zh:'\u8bed\u8a00',hi:'\u092d\u093e\u0937\u093e',ar:'\u0627\u0644\u0644\u063a\u0629',pt:'Idioma',fr:'Langue',de:'Sprache',ja:'\u8a00\u8a9e',ru:'\u042f\u0437\u044b\u043a'},
  'Billing':{bn:'বিলিং',ur:'بلنگ',ko:'결제',ta:'பில்லிங்',id:'Tagihan',it:'Fatturazione',tr:'Faturalama',vi:'Thanh toán',es:'Facturaci\u00f3n',zh:'\u8d26\u5355',hi:'\u092c\u093f\u0932\u093f\u0902\u0917',ar:'\u0627\u0644\u0641\u0648\u062a\u0631\u0629',pt:'Faturamento',fr:'Facturation',de:'Abrechnung',ja:'\u8acb\u6c42',ru:'\u041e\u043f\u043b\u0430\u0442\u0430'},
  'About':{id:'Tentang',bn:'\u09b8\u09ae\u09cd\u09aa\u09b0\u09cd\u0995\u09c7',ur:'\u0645\u062a\u0639\u0644\u0642',tr:'Hakk\u0131nda',vi:'Gi\u1edbi thi\u1ec7u',it:'Informazioni',ko:'\uc815\ubcf4',ta:'\u0baa\u0bb1\u0bcd\u0bb1\u0bbf',es:'Acerca de',zh:'\u5173\u4e8e',hi:'\u092c\u093e\u0930\u0947 \u092e\u0947\u0902',ar:'\u062d\u0648\u0644',pt:'Sobre',fr:'\u00c0 propos',de:'\u00dcber',ja:'\u6982\u8981',ru:'\u041e \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435'},
  'Live / Backend':{es:'En vivo / Backend',zh:'\u5b9e\u65f6 / \u540e\u7aef',hi:'\u0932\u093e\u0907\u0935 / \u092c\u0948\u0915\u090f\u0902\u0921',ar:'\u0645\u0628\u0627\u0634\u0631 / \u0627\u0644\u062e\u0627\u062f\u0645',pt:'Ao vivo / Backend',fr:'Live / Backend',de:'Live / Backend',ja:'\u30e9\u30a4\u30d6 / \u30d0\u30c3\u30af\u30a8\u30f3\u30c9',ru:'\u041e\u043d\u043b\u0430\u0439\u043d / \u0411\u044d\u043a\u0435\u043d\u0434'},
  'AI Connection':{es:'Conexi\u00f3n IA',zh:'AI \u8fde\u63a5',hi:'AI \u0915\u0928\u0947\u0915\u094d\u0936\u0928',ar:'\u0627\u062a\u0635\u0627\u0644 \u0627\u0644\u0630\u0643\u0627\u0621',pt:'Conex\u00e3o IA',fr:'Connexion IA',de:'KI-Verbindung',ja:'AI\u63a5\u7d9a',ru:'\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0418\u0418'},
  'Choose the language for AMV\u2019s responses and the content it generates - chat replies, images, video, and 3D models will all use it. You can still ask for any other language inside a message.':{es:'Elige el idioma para las respuestas de AMV y el contenido que genera: respuestas de chat, im\u00e1genes, video y modelos 3D lo usar\u00e1n. Puedes pedir otro idioma dentro de un mensaje.',ar:'\u0627\u062e\u062a\u0631 \u0644\u063a\u0629 \u0631\u062f\u0648\u062f AMV \u0648\u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0630\u064a \u064a\u0646\u0634\u0626\u0647 - \u0633\u062a\u0633\u062a\u062e\u062f\u0645\u0647\u0627 \u0631\u062f\u0648\u062f \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629 \u0648\u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u0641\u064a\u062f\u064a\u0648 \u0648\u0627\u0644\u0646\u0645\u0627\u0630\u062c. \u064a\u0645\u0643\u0646\u0643 \u0637\u0644\u0628 \u0623\u064a \u0644\u063a\u0629 \u0623\u062e\u0631\u0649 \u062f\u0627\u062e\u0644 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.',fr:'Choisissez la langue des r\u00e9ponses d\u2019AMV et du contenu g\u00e9n\u00e9r\u00e9 - r\u00e9ponses, images, vid\u00e9os et mod\u00e8les 3D l\u2019utiliseront. Vous pouvez demander une autre langue dans un message.',de:'W\u00e4hle die Sprache f\u00fcr AMVs Antworten und generierte Inhalte - Chat, Bilder, Video und 3D-Modelle nutzen sie. Du kannst in einer Nachricht jede andere Sprache anfordern.',zh:'\u9009\u62e9 AMV \u56de\u590d\u548c\u751f\u6210\u5185\u5bb9\u7684\u8bed\u8a00--\u804a\u5929\u56de\u590d\u3001\u56fe\u50cf\u3001\u89c6\u9891\u548c 3D \u6a21\u578b\u90fd\u4f1a\u4f7f\u7528\u5b83\u3002\u4f60\u4ecd\u53ef\u5728\u6d88\u606f\u4e2d\u8981\u6c42\u5176\u4ed6\u8bed\u8a00\u3002',hi:'AMV \u0915\u0940 \u092a\u094d\u0930\u0924\u093f\u0915\u094d\u0930\u093f\u092f\u093e\u0913\u0902 \u0914\u0930 \u0938\u093e\u092e\u0917\u094d\u0930\u0940 \u0915\u0947 \u0932\u093f\u090f \u092d\u093e\u0937\u093e \u091a\u0941\u0928\u0947\u0902\u0964',pt:'Escolha o idioma das respostas do AMV e do conte\u00fado gerado - respostas, imagens, v\u00eddeo e modelos 3D o usar\u00e3o. Voc\u00ea pode pedir outro idioma em uma mensagem.',ja:'AMV\u306e\u5fdc\u7b54\u3068\u751f\u6210\u30b3\u30f3\u30c6\u30f3\u30c4\u306e\u8a00\u8a9e\u3092\u9078\u629e-\u30c1\u30e3\u30c3\u30c8\u3001\u753b\u50cf\u3001\u52d5\u753b\u30013D\u30e2\u30c7\u30eb\u306b\u4f7f\u7528\u3055\u308c\u307e\u3059\u3002\u30e1\u30c3\u30bb\u30fc\u30b8\u5185\u3067\u4ed6\u306e\u8a00\u8a9e\u3082\u4f9d\u983c\u3067\u304d\u307e\u3059\u3002',ru:'\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0437\u044b\u043a \u043e\u0442\u0432\u0435\u0442\u043e\u0432 AMV \u0438 \u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u0435\u043c\u043e\u0433\u043e \u043a\u043e\u043d\u0442\u0435\u043d\u0442\u0430.'},
  'Save':{bn:'সংরক্ষণ',ur:'محفوظ کریں',ko:'저장',ta:'சேமி',id:'Simpan',it:'Salva',tr:'Kaydet',vi:'L\u01b0u',es:'Guardar',zh:'\u4fdd\u5b58',hi:'\u0938\u0939\u0947\u091c\u0947\u0902',ar:'\u062d\u0641\u0638',pt:'Salvar',fr:'Enregistrer',de:'Speichern',ja:'\u4fdd\u5b58',ru:'\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c'},
  'Cancel':{bn:'বাতিল',ur:'منسوخ',ko:'취소',ta:'ரத்து',id:'Batal',it:'Annulla',tr:'\u0130ptal',vi:'H\u1ee7y',es:'Cancelar',zh:'\u53d6\u6d88',hi:'\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902',ar:'\u0625\u0644\u063a\u0627\u0621',pt:'Cancelar',fr:'Annuler',de:'Abbrechen',ja:'\u30ad\u30e3\u30f3\u30bb\u30eb',ru:'\u041e\u0442\u043c\u0435\u043d\u0430'},
  'Send':{bn:'পাঠান',ur:'بھیجیں',ko:'보내기',ta:'அனுப்பு',id:'Kirim',it:'Invia',tr:'G\u00f6nder',vi:'G\u1eedi',es:'Enviar',zh:'\u53d1\u9001',hi:'\u092d\u0947\u091c\u0947\u0902',ar:'\u0625\u0631\u0633\u0627\u0644',pt:'Enviar',fr:'Envoyer',de:'Senden',ja:'\u9001\u4fe1',ru:'\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c'},
  'Run':{es:'Ejecutar',zh:'\u8fd0\u884c',hi:'\u091a\u0932\u093e\u090f\u0902',ar:'\u062a\u0634\u063a\u064a\u0644',pt:'Executar',fr:'Ex\u00e9cuter',de:'Ausf\u00fchren',ja:'\u5b9f\u884c',ru:'\u0417\u0430\u043f\u0443\u0441\u043a'},
  'What should I handle for you?':{es:'\u00bfQu\u00e9 puedo hacer por ti?',zh:'\u6709\u4ec0\u4e48\u9700\u8981\u6211\u5904\u7406\u7684\uff1f',hi:'\u092e\u0948\u0902 \u0906\u092a\u0915\u0947 \u0932\u093f\u090f \u0915\u094d\u092f\u093e \u0915\u0930\u0942\u0901?',ar:'\u0628\u0645\u0627\u0630\u0627 \u064a\u0645\u0643\u0646\u0646\u064a \u0645\u0633\u0627\u0639\u062f\u062a\u0643\u061f',pt:'O que posso fazer por voc\u00ea?',fr:'Que puis-je faire pour vous\u00a0?',de:'Was kann ich f\u00fcr dich tun?',ja:'\u4f55\u3092\u304a\u624b\u4f1d\u3044\u3057\u307e\u3057\u3087\u3046\u304b\uff1f',ru:'\u0427\u0435\u043c \u044f \u043c\u043e\u0433\u0443 \u043f\u043e\u043c\u043e\u0447\u044c?'},
  'Profile':{id:'Profil',bn:'\u09aa\u09cd\u09b0\u09cb\u09ab\u09be\u0987\u09b2',ur:'\u067e\u0631\u0648\u0641\u0627\u0626\u0644',tr:'Profil',vi:'H\u1ed3 s\u01a1',it:'Profilo',ko:'\ud504\ub85c\ud544',ta:'\u0b9a\u0bc1\u0baf\u0bb5\u0bbf\u0bb5\u0bb0\u0bae\u0bcd',es:'Perfil',zh:'\u4e2a\u4eba\u8d44\u6599',hi:'\u092a\u094d\u0930\u094b\u092b\u093c\u093e\u0907\u0932',ar:'\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062e\u0635\u064a',pt:'Perfil',fr:'Profil',de:'Profil',ja:'\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb',ru:'\u041f\u0440\u043e\u0444\u0438\u043b\u044c'},
  'Sign out':{id:'Keluar',bn:'\u09b8\u09be\u0987\u09a8 \u0986\u0989\u099f',ur:'\u0633\u0627\u0626\u0646 \u0622\u0624\u0679',tr:'\u00c7\u0131k\u0131\u015f yap',vi:'\u0110\u0103ng xu\u1ea5t',it:'Esci',ko:'\ub85c\uadf8\uc544\uc6c3',ta:'\u0bb5\u0bc6\u0bb3\u0bbf\u0baf\u0bc7\u0bb1\u0bc1',es:'Cerrar sesi\u00f3n',zh:'\u9000\u51fa',hi:'\u0938\u093e\u0907\u0928 \u0906\u0909\u091f',ar:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c',pt:'Sair',fr:'D\u00e9connexion',de:'Abmelden',ja:'\u30b5\u30a4\u30f3\u30a2\u30a6\u30c8',ru:'\u0412\u044b\u0439\u0442\u0438'},
  'Theme':{id:'Tema',bn:'\u09a5\u09bf\u09ae',ur:'\u062a\u06be\u06cc\u0645',tr:'Tema',vi:'Ch\u1ee7 \u0111\u1ec1',it:'Tema',ko:'\ud14c\ub9c8',ta:'\u0ba4\u0bc0\u0bae\u0bcd',es:'Tema',zh:'\u4e3b\u9898',hi:'\u0925\u0940\u092e',ar:'\u0627\u0644\u0633\u0645\u0629',pt:'Tema',fr:'Th\u00e8me',de:'Design',ja:'\u30c6\u30fc\u30de',ru:'\u0422\u0435\u043c\u0430'},
  'Dark Mode':{es:'Modo oscuro',zh:'\u6df1\u8272\u6a21\u5f0f',hi:'\u0921\u093e\u0930\u094d\u0915 \u092e\u094b\u0921',ar:'\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u062f\u0627\u0643\u0646',pt:'Modo escuro',fr:'Mode sombre',de:'Dunkelmodus',ja:'\u30c0\u30fc\u30af\u30e2\u30fc\u30c9',ru:'\u0422\u0451\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430'},
  'Font Size':{es:'Tama\u00f1o de fuente',zh:'\u5b57\u4f53\u5927\u5c0f',hi:'\u092b\u093c\u0949\u0928\u094d\u091f \u0906\u0915\u093e\u0930',ar:'\u062d\u062c\u0645 \u0627\u0644\u062e\u0637',pt:'Tamanho da fonte',fr:'Taille de police',de:'Schriftgr\u00f6\u00dfe',ja:'\u30d5\u30a9\u30f3\u30c8\u30b5\u30a4\u30ba',ru:'\u0420\u0430\u0437\u043c\u0435\u0440 \u0448\u0440\u0438\u0444\u0442\u0430'},
  'Small':{es:'Peque\u00f1o',zh:'\u5c0f',hi:'\u091b\u094b\u091f\u093e',ar:'\u0635\u063a\u064a\u0631',pt:'Pequeno',fr:'Petit',de:'Klein',ja:'\u5c0f',ru:'\u041c\u0430\u043b\u044b\u0439'},
  'Medium':{es:'Mediano',zh:'\u4e2d',hi:'\u092e\u0927\u094d\u092f\u092e',ar:'\u0645\u062a\u0648\u0633\u0637',pt:'M\u00e9dio',fr:'Moyen',de:'Mittel',ja:'\u4e2d',ru:'\u0421\u0440\u0435\u0434\u043d\u0438\u0439'},
  'Large':{es:'Grande',zh:'\u5927',hi:'\u092c\u0921\u093c\u093e',ar:'\u0643\u0628\u064a\u0631',pt:'Grande',fr:'Grand',de:'Gro\u00df',ja:'\u5927',ru:'\u0411\u043e\u043b\u044c\u0448\u043e\u0439'},
  'Customize how AMV.AI looks and feels.':{es:'Personaliza el aspecto de AMV.AI.',zh:'\u81ea\u5b9a\u4e49 AMV.AI \u7684\u5916\u89c2\u3002',ar:'\u062e\u0635\u0635 \u0634\u0643\u0644 AMV.AI \u0648\u0625\u062d\u0633\u0627\u0633\u0647.',fr:'Personnalisez l\u2019apparence d\u2019AMV.AI.',de:'Passe das Aussehen von AMV.AI an.',hi:'AMV.AI \u0915\u093e \u0930\u0942\u092a \u0905\u0928\u0941\u0915\u0942\u0932\u093f\u0924 \u0915\u0930\u0947\u0902\u0964',pt:'Personalize a apar\u00eancia do AMV.AI.',ja:'AMV.AI\u306e\u898b\u305f\u76ee\u3092\u30ab\u30b9\u30bf\u30de\u30a4\u30ba\u3002',ru:'\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0432\u0438\u0434 AMV.AI.'},
  'Manage your profile and account information.':{es:'Gestiona tu perfil e informaci\u00f3n de cuenta.',zh:'\u7ba1\u7406\u60a8\u7684\u4e2a\u4eba\u8d44\u6599\u548c\u8d26\u6237\u4fe1\u606f\u3002',ar:'\u0623\u062f\u0631 \u0645\u0644\u0641\u0643 \u0627\u0644\u0634\u062e\u0635\u064a \u0648\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u062d\u0633\u0627\u0628\u0643.',fr:'G\u00e9rez votre profil et vos informations.',de:'Verwalte dein Profil und deine Kontodaten.',hi:'\u0905\u092a\u0928\u0940 \u092a\u094d\u0930\u094b\u092b\u093c\u093e\u0907\u0932 \u092a\u094d\u0930\u092c\u0902\u0927\u093f\u0924 \u0915\u0930\u0947\u0902\u0964',pt:'Gerencie seu perfil e informa\u00e7\u00f5es da conta.',ja:'\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u3068\u30a2\u30ab\u30a6\u30f3\u30c8\u60c5\u5831\u3092\u7ba1\u7406\u3002',ru:'\u0423\u043f\u0440\u0430\u0432\u043b\u044f\u0439\u0442\u0435 \u043f\u0440\u043e\u0444\u0438\u043b\u0435\u043c \u0438 \u0434\u0430\u043d\u043d\u044b\u043c\u0438 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.'},
  'Manage your password and account security.':{es:'Gestiona tu contrase\u00f1a y seguridad.',zh:'\u7ba1\u7406\u60a8\u7684\u5bc6\u7801\u548c\u8d26\u6237\u5b89\u5168\u3002',ar:'\u0623\u062f\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0648\u0623\u0645\u0627\u0646 \u062d\u0633\u0627\u0628\u0643.',fr:'G\u00e9rez votre mot de passe et s\u00e9curit\u00e9.',de:'Verwalte Passwort und Kontosicherheit.',hi:'\u0905\u092a\u0928\u093e \u092a\u093e\u0938\u0935\u0930\u094d\u0921 \u092a\u094d\u0930\u092c\u0902\u0927\u093f\u0924 \u0915\u0930\u0947\u0902\u0964',pt:'Gerencie sua senha e seguran\u00e7a.',ja:'\u30d1\u30b9\u30ef\u30fc\u30c9\u3068\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u3092\u7ba1\u7406\u3002',ru:'\u0423\u043f\u0440\u0430\u0432\u043b\u044f\u0439\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u0435\u043c \u0438 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c\u044e.'},
};

/* Merge the comprehensive UI dictionary (all 19 languages) so the interface
   translates fully without an API key. Existing richer entries win. */
(function(){try{var __D={"Chat":{"es":"Chat","zh":"聊天","hi":"चैट","ar":"الدردشة","pt":"Conversa","fr":"Discussion","de":"Chat","ja":"チャット","ru":"Чат","id":"Obrolan","bn":"চ্যাট","ur":"چیٹ","tr":"Sohbet","vi":"Trò chuyện","it":"Chat","ko":"채팅","ta":"அரட்டை"},"Images":{"es":"Imágenes","zh":"图片","hi":"छवियाँ","ar":"الصور","pt":"Imagens","fr":"Images","de":"Bilder","ja":"画像","ru":"Изображения","id":"Gambar","bn":"ছবি","ur":"تصاویر","tr":"Görseller","vi":"Hình ảnh","it":"Immagini","ko":"이미지","ta":"படங்கள்"},"Video":{"es":"Vídeo","zh":"视频","hi":"वीडियो","ar":"الفيديو","pt":"Vídeo","fr":"Vidéo","de":"Video","ja":"動画","ru":"Видео","id":"Video","bn":"ভিডিও","ur":"ویڈیو","tr":"Video","vi":"Video","it":"Video","ko":"비디오","ta":"வீடியோ"},"Crew":{"es":"Equipo","zh":"团队","hi":"दल","ar":"الطاقم","pt":"Equipe","fr":"Équipe","de":"Team","ja":"クルー","ru":"Команда","id":"Kru","bn":"ক্রু","ur":"عملہ","tr":"Ekip","vi":"Nhóm","it":"Squadra","ko":"크루","ta":"குழு"},"Handoff":{"es":"Transferir","zh":"交接","hi":"सौंपना","ar":"التسليم","pt":"Transferir","fr":"Transfert","de":"Übergabe","ja":"引き継ぎ","ru":"Передача","id":"Serah","bn":"হস্তান্তর","ur":"حوالگی","tr":"Devir","vi":"Bàn giao","it":"Passaggio","ko":"핸드오프","ta":"ஒப்படைப்பு"},"Studio":{"es":"Estudio","zh":"工作室","hi":"स्टूडियो","ar":"الاستوديو","pt":"Estúdio","fr":"Studio","de":"Studio","ja":"スタジオ","ru":"Студия","id":"Studio","bn":"স্টুডিও","ur":"اسٹوڈیو","tr":"Stüdyo","vi":"Studio","it":"Studio","ko":"스튜디오","ta":"ஸ்டுடியோ"},"Dev":{"es":"Dev","zh":"开发","hi":"डेव","ar":"المطور","pt":"Dev","fr":"Dev","de":"Dev","ja":"開発","ru":"Разработка","id":"Dev","bn":"ডেভ","ur":"ڈیو","tr":"Dev","vi":"Dev","it":"Dev","ko":"개발","ta":"டெவ்"},"Lab":{"es":"Laboratorio","zh":"实验室","hi":"लैब","ar":"المختبر","pt":"Laboratório","fr":"Labo","de":"Labor","ja":"ラボ","ru":"Лаборатория","id":"Lab","bn":"ল্যাব","ur":"لیب","tr":"Lab","vi":"Phòng thí nghiệm","it":"Laboratorio","ko":"랩","ta":"ஆய்வகம்"},"Projects":{"es":"Proyectos","zh":"项目","hi":"परियोजनाएँ","ar":"المشاريع","pt":"Projetos","fr":"Projets","de":"Projekte","ja":"プロジェクト","ru":"Проекты","id":"Proyek","bn":"প্রকল্প","ur":"منصوبے","tr":"Projeler","vi":"Dự án","it":"Progetti","ko":"프로젝트","ta":"திட்டங்கள்"},"Memory":{"es":"Memoria","zh":"记忆","hi":"स्मृति","ar":"الذاكرة","pt":"Memória","fr":"Mémoire","de":"Speicher","ja":"メモリ","ru":"Память","id":"Memori","bn":"স্মৃতি","ur":"یادداشت","tr":"Bellek","vi":"Bộ nhớ","it":"Memoria","ko":"메모리","ta":"நினைவகம்"},"Tasks":{"es":"Tareas","zh":"任务","hi":"कार्य","ar":"المهام","pt":"Tarefas","fr":"Tâches","de":"Aufgaben","ja":"タスク","ru":"Задачи","id":"Tugas","bn":"কাজ","ur":"کام","tr":"Görevler","vi":"Nhiệm vụ","it":"Attività","ko":"작업","ta":"பணிகள்"},"Marketplace":{"es":"Mercado","zh":"市场","hi":"मार्केटप्लेस","ar":"السوق","pt":"Mercado","fr":"Marché","de":"Marktplatz","ja":"マーケット","ru":"Маркет","id":"Pasar","bn":"মার্কেটপ্লেস","ur":"مارکیٹ","tr":"Pazar","vi":"Chợ","it":"Mercato","ko":"마켓플레이스","ta":"சந்தை"},"Plans":{"es":"Planes","zh":"套餐","hi":"योजनाएँ","ar":"الخطط","pt":"Planos","fr":"Forfaits","de":"Tarife","ja":"プラン","ru":"Тарифы","id":"Paket","bn":"প্ল্যান","ur":"منصوبے","tr":"Planlar","vi":"Gói","it":"Piani","ko":"요금제","ta":"திட்டங்கள்"},"Create":{"es":"Crear","zh":"创作","hi":"बनाएँ","ar":"إنشاء","pt":"Criar","fr":"Créer","de":"Erstellen","ja":"作成","ru":"Создать","id":"Buat","bn":"তৈরি করুন","ur":"بنائیں","tr":"Oluştur","vi":"Tạo","it":"Crea","ko":"만들기","ta":"உருவாக்கு"},"Agents":{"es":"Agentes","zh":"智能体","hi":"एजेंट","ar":"الوكلاء","pt":"Agentes","fr":"Agents","de":"Agenten","ja":"エージェント","ru":"Агенты","id":"Agen","bn":"এজেন্ট","ur":"ایجنٹس","tr":"Ajanlar","vi":"Tác nhân","it":"Agenti","ko":"에이전트","ta":"முகவர்கள்"},"Build":{"es":"Construir","zh":"构建","hi":"निर्माण","ar":"بناء","pt":"Construir","fr":"Construire","de":"Erstellen","ja":"ビルド","ru":"Сборка","id":"Bangun","bn":"নির্মাণ","ur":"تعمیر","tr":"Oluştur","vi":"Xây dựng","it":"Costruisci","ko":"빌드","ta":"உருவாக்கு"},"Workspace":{"es":"Espacio","zh":"工作区","hi":"कार्यस्थान","ar":"مساحة العمل","pt":"Espaço","fr":"Espace","de":"Arbeitsbereich","ja":"ワークスペース","ru":"Рабочая область","id":"Ruang kerja","bn":"কর্মক্ষেত্র","ur":"ورک اسپیس","tr":"Çalışma alanı","vi":"Không gian làm việc","it":"Area di lavoro","ko":"작업 공간","ta":"பணியிடம்"},"Recents":{"es":"Recientes","zh":"最近","hi":"हाल के","ar":"الأخيرة","pt":"Recentes","fr":"Récents","de":"Kürzlich","ja":"最近","ru":"Недавние","id":"Terbaru","bn":"সাম্প্রতিক","ur":"حالیہ","tr":"Son kullanılanlar","vi":"Gần đây","it":"Recenti","ko":"최근","ta":"சமீபத்தியவை"},"General":{"es":"General","zh":"通用","hi":"सामान्य","ar":"عام","pt":"Geral","fr":"Général","de":"Allgemein","ja":"一般","ru":"Общие","id":"Umum","bn":"সাধারণ","ur":"عام","tr":"Genel","vi":"Chung","it":"Generale","ko":"일반","ta":"பொது"},"Customize":{"es":"Personalizar","zh":"自定义","hi":"अनुकूलित","ar":"تخصيص","pt":"Personalizar","fr":"Personnaliser","de":"Anpassen","ja":"カスタマイズ","ru":"Настроить","id":"Sesuaikan","bn":"কাস্টমাইজ","ur":"حسب ضرورت","tr":"Özelleştir","vi":"Tùy chỉnh","it":"Personalizza","ko":"맞춤 설정","ta":"தனிப்பயனாக்கு"},"New chat":{"es":"Nueva conversación","zh":"新对话","hi":"नई चैट","ar":"محادثة جديدة","pt":"Nova conversa","fr":"Nouvelle discussion","de":"Neuer Chat","ja":"新しいチャット","ru":"Новый чат","id":"Obrolan baru","bn":"নতুন চ্যাট","ur":"نئی چیٹ","tr":"Yeni sohbet","vi":"Trò chuyện mới","it":"Nuova chat","ko":"새 채팅","ta":"புதிய அரட்டை"},"New project":{"es":"Nuevo proyecto","zh":"新项目","hi":"नई परियोजना","ar":"مشروع جديد","pt":"Novo projeto","fr":"Nouveau projet","de":"Neues Projekt","ja":"新規プロジェクト","ru":"Новый проект","id":"Proyek baru","bn":"নতুন প্রকল্প","ur":"نیا منصوبہ","tr":"Yeni proje","vi":"Dự án mới","it":"Nuovo progetto","ko":"새 프로젝트","ta":"புதிய திட்டம்"},"New session":{"es":"Nueva sesión","zh":"新会话","hi":"नया सत्र","ar":"جلسة جديدة","pt":"Nova sessão","fr":"Nouvelle session","de":"Neue Sitzung","ja":"新しいセッション","ru":"Новая сессия","id":"Sesi baru","bn":"নতুন সেশন","ur":"نیا سیشن","tr":"Yeni oturum","vi":"Phiên mới","it":"Nuova sessione","ko":"새 세션","ta":"புதிய அமர்வு"},"Generate":{"es":"Generar","zh":"生成","hi":"उत्पन्न करें","ar":"إنشاء","pt":"Gerar","fr":"Générer","de":"Generieren","ja":"生成","ru":"Создать","id":"Hasilkan","bn":"তৈরি করুন","ur":"بنائیں","tr":"Oluştur","vi":"Tạo","it":"Genera","ko":"생성","ta":"உருவாக்கு"},"Send":{"es":"Enviar","zh":"发送","hi":"भेजें","ar":"إرسال","pt":"Enviar","fr":"Envoyer","de":"Senden","ja":"送信","ru":"Отправить","id":"Kirim","bn":"পাঠান","ur":"بھیجیں","tr":"Gönder","vi":"Gửi","it":"Invia","ko":"보내기","ta":"அனுப்பு"},"Send message":{"es":"Enviar mensaje","zh":"发送消息","hi":"संदेश भेजें","ar":"إرسال رسالة","pt":"Enviar mensagem","fr":"Envoyer le message","de":"Nachricht senden","ja":"メッセージを送信","ru":"Отправить сообщение","id":"Kirim pesan","bn":"বার্তা পাঠান","ur":"پیغام بھیجیں","tr":"Mesaj gönder","vi":"Gửi tin nhắn","it":"Invia messaggio","ko":"메시지 보내기","ta":"செய்தி அனுப்பு"},"Run":{"es":"Ejecutar","zh":"运行","hi":"चलाएँ","ar":"تشغيل","pt":"Executar","fr":"Exécuter","de":"Ausführen","ja":"実行","ru":"Запустить","id":"Jalankan","bn":"চালান","ur":"چلائیں","tr":"Çalıştır","vi":"Chạy","it":"Esegui","ko":"실행","ta":"இயக்கு"},"Write":{"es":"Escribir","zh":"写作","hi":"लिखें","ar":"كتابة","pt":"Escrever","fr":"Écrire","de":"Schreiben","ja":"書く","ru":"Написать","id":"Tulis","bn":"লিখুন","ur":"لکھیں","tr":"Yaz","vi":"Viết","it":"Scrivi","ko":"작성","ta":"எழுது"},"Browse":{"es":"Explorar","zh":"浏览","hi":"ब्राउज़ करें","ar":"تصفح","pt":"Navegar","fr":"Parcourir","de":"Durchsuchen","ja":"閲覧","ru":"Обзор","id":"Jelajahi","bn":"ব্রাউজ করুন","ur":"براؤز کریں","tr":"Gözat","vi":"Duyệt","it":"Sfoglia","ko":"둘러보기","ta":"உலாவு"},"Sell":{"es":"Vender","zh":"出售","hi":"बेचें","ar":"بيع","pt":"Vender","fr":"Vendre","de":"Verkaufen","ja":"販売","ru":"Продать","id":"Jual","bn":"বিক্রি","ur":"بیچیں","tr":"Sat","vi":"Bán","it":"Vendi","ko":"판매","ta":"விற்பனை"},"Connect":{"es":"Conectar","zh":"连接","hi":"कनेक्ट करें","ar":"ربط","pt":"Conectar","fr":"Connecter","de":"Verbinden","ja":"接続","ru":"Подключить","id":"Hubungkan","bn":"সংযোগ করুন","ur":"جوڑیں","tr":"Bağlan","vi":"Kết nối","it":"Connetti","ko":"연결","ta":"இணை"},"Manage":{"es":"Gestionar","zh":"管理","hi":"प्रबंधित करें","ar":"إدارة","pt":"Gerenciar","fr":"Gérer","de":"Verwalten","ja":"管理","ru":"Управлять","id":"Kelola","bn":"পরিচালনা","ur":"نظم کریں","tr":"Yönet","vi":"Quản lý","it":"Gestisci","ko":"관리","ta":"நிர்வகி"},"Automate":{"es":"Automatizar","zh":"自动化","hi":"स्वचालित करें","ar":"أتمتة","pt":"Automatizar","fr":"Automatiser","de":"Automatisieren","ja":"自動化","ru":"Автоматизировать","id":"Otomatiskan","bn":"স্বয়ংক্রিয়","ur":"خودکار","tr":"Otomatikleştir","vi":"Tự động hóa","it":"Automatizza","ko":"자동화","ta":"தானியக்கம்"},"Save changes":{"es":"Guardar cambios","zh":"保存更改","hi":"परिवर्तन सहेजें","ar":"حفظ التغييرات","pt":"Salvar alterações","fr":"Enregistrer","de":"Änderungen speichern","ja":"変更を保存","ru":"Сохранить","id":"Simpan perubahan","bn":"পরিবর্তন সংরক্ষণ","ur":"تبدیلیاں محفوظ کریں","tr":"Değişiklikleri kaydet","vi":"Lưu thay đổi","it":"Salva modifiche","ko":"변경 사항 저장","ta":"மாற்றங்களைச் சேமி"},"Close":{"es":"Cerrar","zh":"关闭","hi":"बंद करें","ar":"إغلاق","pt":"Fechar","fr":"Fermer","de":"Schließen","ja":"閉じる","ru":"Закрыть","id":"Tutup","bn":"বন্ধ করুন","ur":"بند کریں","tr":"Kapat","vi":"Đóng","it":"Chiudi","ko":"닫기","ta":"மூடு"},"More":{"es":"Más","zh":"更多","hi":"और","ar":"المزيد","pt":"Mais","fr":"Plus","de":"Mehr","ja":"もっと","ru":"Ещё","id":"Lainnya","bn":"আরও","ur":"مزید","tr":"Daha fazla","vi":"Thêm","it":"Altro","ko":"더 보기","ta":"மேலும்"},"All":{"es":"Todos","zh":"全部","hi":"सभी","ar":"الكل","pt":"Todos","fr":"Tous","de":"Alle","ja":"すべて","ru":"Все","id":"Semua","bn":"সব","ur":"سب","tr":"Tümü","vi":"Tất cả","it":"Tutti","ko":"전체","ta":"அனைத்தும்"},"Attach file":{"es":"Adjuntar archivo","zh":"附加文件","hi":"फ़ाइल संलग्न करें","ar":"إرفاق ملف","pt":"Anexar arquivo","fr":"Joindre un fichier","de":"Datei anhängen","ja":"ファイルを添付","ru":"Прикрепить файл","id":"Lampirkan file","bn":"ফাইল সংযুক্ত করুন","ur":"فائل منسلک کریں","tr":"Dosya ekle","vi":"Đính kèm tệp","it":"Allega file","ko":"파일 첨부","ta":"கோப்பை இணை"},"Voice input":{"es":"Entrada de voz","zh":"语音输入","hi":"आवाज़ इनपुट","ar":"إدخال صوتي","pt":"Entrada de voz","fr":"Entrée vocale","de":"Spracheingabe","ja":"音声入力","ru":"Голосовой ввод","id":"Input suara","bn":"ভয়েস ইনপুট","ur":"صوتی ان پٹ","tr":"Sesli giriş","vi":"Nhập bằng giọng nói","it":"Input vocale","ko":"음성 입력","ta":"குரல் உள்ளீடு"},"Web search":{"es":"Búsqueda web","zh":"网页搜索","hi":"वेब खोज","ar":"بحث الويب","pt":"Busca na web","fr":"Recherche web","de":"Websuche","ja":"ウェブ検索","ru":"Веб-поиск","id":"Pencarian web","bn":"ওয়েব অনুসন্ধান","ur":"ویب تلاش","tr":"Web araması","vi":"Tìm kiếm web","it":"Ricerca web","ko":"웹 검색","ta":"வலைத் தேடல்"},"Settings":{"es":"Ajustes","zh":"设置","hi":"सेटिंग्स","ar":"الإعدادات","pt":"Configurações","fr":"Paramètres","de":"Einstellungen","ja":"設定","ru":"Настройки","id":"Pengaturan","bn":"সেটিংস","ur":"ترتیبات","tr":"Ayarlar","vi":"Cài đặt","it":"Impostazioni","ko":"설정","ta":"அமைப்புகள்"},"Account":{"es":"Cuenta","zh":"账户","hi":"खाता","ar":"الحساب","pt":"Conta","fr":"Compte","de":"Konto","ja":"アカウント","ru":"Аккаунт","id":"Akun","bn":"অ্যাকাউন্ট","ur":"اکاؤنٹ","tr":"Hesap","vi":"Tài khoản","it":"Account","ko":"계정","ta":"கணக்கு"},"Privacy":{"es":"Privacidad","zh":"隐私","hi":"गोपनीयता","ar":"الخصوصية","pt":"Privacidade","fr":"Confidentialité","de":"Datenschutz","ja":"プライバシー","ru":"Конфиденциальность","id":"Privasi","bn":"গোপনীয়তা","ur":"رازداری","tr":"Gizlilik","vi":"Quyền riêng tư","it":"Privacy","ko":"개인정보","ta":"தனியுரிமை"},"Security":{"es":"Seguridad","zh":"安全","hi":"सुरक्षा","ar":"الأمان","pt":"Segurança","fr":"Sécurité","de":"Sicherheit","ja":"セキュリティ","ru":"Безопасность","id":"Keamanan","bn":"নিরাপত্তা","ur":"سیکیورٹی","tr":"Güvenlik","vi":"Bảo mật","it":"Sicurezza","ko":"보안","ta":"பாதுகாப்பு"},"Billing":{"es":"Facturación","zh":"账单","hi":"बिलिंग","ar":"الفوترة","pt":"Faturamento","fr":"Facturation","de":"Abrechnung","ja":"請求","ru":"Оплата","id":"Penagihan","bn":"বিলিং","ur":"بلنگ","tr":"Faturalandırma","vi":"Thanh toán","it":"Fatturazione","ko":"결제","ta":"பில்லிங்"},"Usage":{"es":"Uso","zh":"用量","hi":"उपयोग","ar":"الاستخدام","pt":"Uso","fr":"Utilisation","de":"Nutzung","ja":"使用状況","ru":"Использование","id":"Penggunaan","bn":"ব্যবহার","ur":"استعمال","tr":"Kullanım","vi":"Sử dụng","it":"Utilizzo","ko":"사용량","ta":"பயன்பாடு"},"Capabilities":{"es":"Capacidades","zh":"功能","hi":"क्षमताएँ","ar":"القدرات","pt":"Recursos","fr":"Capacités","de":"Funktionen","ja":"機能","ru":"Возможности","id":"Kemampuan","bn":"সক্ষমতা","ur":"صلاحیتیں","tr":"Yetenekler","vi":"Khả năng","it":"Funzionalità","ko":"기능","ta":"திறன்கள்"},"Appearance":{"es":"Apariencia","zh":"外观","hi":"दिखावट","ar":"المظهر","pt":"Aparência","fr":"Apparence","de":"Erscheinungsbild","ja":"外観","ru":"Внешний вид","id":"Tampilan","bn":"চেহারা","ur":"ظاہری شکل","tr":"Görünüm","vi":"Giao diện","it":"Aspetto","ko":"모양","ta":"தோற்றம்"},"Language":{"es":"Idioma","zh":"语言","hi":"भाषा","ar":"اللغة","pt":"Idioma","fr":"Langue","de":"Sprache","ja":"言語","ru":"Язык","id":"Bahasa","bn":"ভাষা","ur":"زبان","tr":"Dil","vi":"Ngôn ngữ","it":"Lingua","ko":"언어","ta":"மொழி"},"Skills":{"es":"Habilidades","zh":"技能","hi":"कौशल","ar":"المهارات","pt":"Habilidades","fr":"Compétences","de":"Fähigkeiten","ja":"スキル","ru":"Навыки","id":"Keterampilan","bn":"দক্ষতা","ur":"مہارتیں","tr":"Beceriler","vi":"Kỹ năng","it":"Competenze","ko":"스킬","ta":"திறன்கள்"},"Connectors":{"es":"Conectores","zh":"连接器","hi":"कनेक्टर","ar":"الموصلات","pt":"Conectores","fr":"Connecteurs","de":"Konnektoren","ja":"コネクタ","ru":"Коннекторы","id":"Konektor","bn":"কানেক্টর","ur":"کنیکٹرز","tr":"Bağlayıcılar","vi":"Trình kết nối","it":"Connettori","ko":"커넥터","ta":"இணைப்பிகள்"},"Integrations":{"es":"Integraciones","zh":"集成","hi":"एकीकरण","ar":"التكاملات","pt":"Integrações","fr":"Intégrations","de":"Integrationen","ja":"連携","ru":"Интеграции","id":"Integrasi","bn":"ইন্টিগ্রেশন","ur":"انضمام","tr":"Entegrasyonlar","vi":"Tích hợp","it":"Integrazioni","ko":"통합","ta":"ஒருங்கிணைப்புகள்"},"About":{"es":"Acerca de","zh":"关于","hi":"के बारे में","ar":"حول","pt":"Sobre","fr":"À propos","de":"Über","ja":"概要","ru":"О программе","id":"Tentang","bn":"সম্পর্কে","ur":"بارے میں","tr":"Hakkında","vi":"Giới thiệu","it":"Informazioni","ko":"정보","ta":"பற்றி"},"Preferences":{"es":"Preferencias","zh":"偏好","hi":"प्राथमिकताएँ","ar":"التفضيلات","pt":"Preferências","fr":"Préférences","de":"Einstellungen","ja":"設定","ru":"Настройки","id":"Preferensi","bn":"পছন্দসমূহ","ur":"ترجیحات","tr":"Tercihler","vi":"Tùy chọn","it":"Preferenze","ko":"환경설정","ta":"விருப்பங்கள்"},"Full name":{"es":"Nombre completo","zh":"全名","hi":"पूरा नाम","ar":"الاسم الكامل","pt":"Nome completo","fr":"Nom complet","de":"Vollständiger Name","ja":"氏名","ru":"Полное имя","id":"Nama lengkap","bn":"পুরো নাম","ur":"پورا نام","tr":"Ad soyad","vi":"Họ và tên","it":"Nome completo","ko":"전체 이름","ta":"முழு பெயர்"},"Nickname":{"es":"Apodo","zh":"昵称","hi":"उपनाम","ar":"الكنية","pt":"Apelido","fr":"Surnom","de":"Spitzname","ja":"ニックネーム","ru":"Псевдоним","id":"Nama panggilan","bn":"ডাকনাম","ur":"عرفیت","tr":"Takma ad","vi":"Biệt danh","it":"Soprannome","ko":"닉네임","ta":"புனைப்பெயர்"},"Password":{"es":"Contraseña","zh":"密码","hi":"पासवर्ड","ar":"كلمة المرور","pt":"Senha","fr":"Mot de passe","de":"Passwort","ja":"パスワード","ru":"Пароль","id":"Kata sandi","bn":"পাসওয়ার্ড","ur":"پاس ورڈ","tr":"Şifre","vi":"Mật khẩu","it":"Password","ko":"비밀번호","ta":"கடவுச்சொல்"},"Sign out":{"es":"Cerrar sesión","zh":"退出","hi":"साइन आउट","ar":"تسجيل الخروج","pt":"Sair","fr":"Se déconnecter","de":"Abmelden","ja":"サインアウト","ru":"Выйти","id":"Keluar","bn":"সাইন আউট","ur":"سائن آؤٹ","tr":"Çıkış yap","vi":"Đăng xuất","it":"Esci","ko":"로그아웃","ta":"வெளியேறு"},"Sign Out":{"es":"Cerrar sesión","zh":"退出","hi":"साइन आउट","ar":"تسجيل الخروج","pt":"Sair","fr":"Se déconnecter","de":"Abmelden","ja":"サインアウト","ru":"Выйти","id":"Keluar","bn":"সাইন আউট","ur":"سائن آؤٹ","tr":"Çıkış yap","vi":"Đăng xuất","it":"Esci","ko":"로그아웃","ta":"வெளியேறு"},"Switch Account":{"es":"Cambiar cuenta","zh":"切换账户","hi":"खाता बदलें","ar":"تبديل الحساب","pt":"Trocar conta","fr":"Changer de compte","de":"Konto wechseln","ja":"アカウント切替","ru":"Сменить аккаунт","id":"Ganti akun","bn":"অ্যাকাউন্ট পরিবর্তন","ur":"اکاؤنٹ بدلیں","tr":"Hesap değiştir","vi":"Đổi tài khoản","it":"Cambia account","ko":"계정 전환","ta":"கணக்கை மாற்று"},"Export data":{"es":"Exportar datos","zh":"导出数据","hi":"डेटा निर्यात करें","ar":"تصدير البيانات","pt":"Exportar dados","fr":"Exporter les données","de":"Daten exportieren","ja":"データをエクスポート","ru":"Экспорт данных","id":"Ekspor data","bn":"ডেটা রপ্তানি","ur":"ڈیٹا برآمد کریں","tr":"Verileri dışa aktar","vi":"Xuất dữ liệu","it":"Esporta dati","ko":"데이터 내보내기","ta":"தரவை ஏற்றுமதி செய்"},"Delete everything":{"es":"Eliminar todo","zh":"删除全部","hi":"सब कुछ हटाएँ","ar":"حذف كل شيء","pt":"Excluir tudo","fr":"Tout supprimer","de":"Alles löschen","ja":"すべて削除","ru":"Удалить всё","id":"Hapus semua","bn":"সবকিছু মুছুন","ur":"سب کچھ حذف کریں","tr":"Her şeyi sil","vi":"Xóa mọi thứ","it":"Elimina tutto","ko":"모두 삭제","ta":"அனைத்தையும் நீக்கு"},"Theme":{"es":"Tema","zh":"主题","hi":"थीम","ar":"السمة","pt":"Tema","fr":"Thème","de":"Design","ja":"テーマ","ru":"Тема","id":"Tema","bn":"থিম","ur":"تھیم","tr":"Tema","vi":"Chủ đề","it":"Tema","ko":"테마","ta":"தீம்"},"Dark":{"es":"Oscuro","zh":"深色","hi":"गहरा","ar":"داكن","pt":"Escuro","fr":"Sombre","de":"Dunkel","ja":"ダーク","ru":"Тёмная","id":"Gelap","bn":"ডার্ক","ur":"گہرا","tr":"Koyu","vi":"Tối","it":"Scuro","ko":"다크","ta":"இருள்"},"Dark Mode":{"es":"Modo oscuro","zh":"深色模式","hi":"डार्क मोड","ar":"الوضع الداكن","pt":"Modo escuro","fr":"Mode sombre","de":"Dunkelmodus","ja":"ダークモード","ru":"Тёмный режим","id":"Mode gelap","bn":"ডার্ক মোড","ur":"ڈارک موڈ","tr":"Koyu mod","vi":"Chế độ tối","it":"Modalità scura","ko":"다크 모드","ta":"இருள் பயன்முறை"},"Font size":{"es":"Tamaño de fuente","zh":"字体大小","hi":"फ़ॉन्ट आकार","ar":"حجم الخط","pt":"Tamanho da fonte","fr":"Taille de police","de":"Schriftgröße","ja":"文字サイズ","ru":"Размер шрифта","id":"Ukuran font","bn":"ফন্ট আকার","ur":"فونٹ سائز","tr":"Yazı tipi boyutu","vi":"Cỡ chữ","it":"Dimensione carattere","ko":"글꼴 크기","ta":"எழுத்துரு அளவு"},"Accent color":{"es":"Color de acento","zh":"强调色","hi":"एक्सेंट रंग","ar":"لون التمييز","pt":"Cor de destaque","fr":"Couleur d’accent","de":"Akzentfarbe","ja":"アクセント色","ru":"Акцентный цвет","id":"Warna aksen","bn":"অ্যাকসেন্ট রঙ","ur":"ایکسنٹ رنگ","tr":"Vurgu rengi","vi":"Màu nhấn","it":"Colore accento","ko":"강조 색상","ta":"முனைப்பு நிறம்"},"Small":{"es":"Pequeño","zh":"小","hi":"छोटा","ar":"صغير","pt":"Pequeno","fr":"Petit","de":"Klein","ja":"小","ru":"Маленький","id":"Kecil","bn":"ছোট","ur":"چھوٹا","tr":"Küçük","vi":"Nhỏ","it":"Piccolo","ko":"작게","ta":"சிறியது"},"Normal":{"es":"Normal","zh":"正常","hi":"सामान्य","ar":"عادي","pt":"Normal","fr":"Normal","de":"Normal","ja":"標準","ru":"Обычный","id":"Normal","bn":"স্বাভাবিক","ur":"عام","tr":"Normal","vi":"Bình thường","it":"Normale","ko":"보통","ta":"இயல்பு"},"Large":{"es":"Grande","zh":"大","hi":"बड़ा","ar":"كبير","pt":"Grande","fr":"Grand","de":"Groß","ja":"大","ru":"Большой","id":"Besar","bn":"বড়","ur":"بڑا","tr":"Büyük","vi":"Lớn","it":"Grande","ko":"크게","ta":"பெரியது"},"Free":{"es":"Gratis","zh":"免费","hi":"मुफ़्त","ar":"مجاني","pt":"Grátis","fr":"Gratuit","de":"Kostenlos","ja":"無料","ru":"Бесплатно","id":"Gratis","bn":"ফ্রি","ur":"مفت","tr":"Ücretsiz","vi":"Miễn phí","it":"Gratis","ko":"무료","ta":"இலவசம்"},"Pro":{"es":"Pro","zh":"专业版","hi":"प्रो","ar":"برو","pt":"Pro","fr":"Pro","de":"Pro","ja":"プロ","ru":"Про","id":"Pro","bn":"প্রো","ur":"پرو","tr":"Pro","vi":"Pro","it":"Pro","ko":"프로","ta":"புரோ"},"Elite":{"es":"Élite","zh":"精英版","hi":"एलीट","ar":"النخبة","pt":"Elite","fr":"Élite","de":"Elite","ja":"エリート","ru":"Элит","id":"Elite","bn":"এলিট","ur":"ایلیٹ","tr":"Elit","vi":"Ưu tú","it":"Elite","ko":"엘리트","ta":"எலைட்"},"Ultra":{"es":"Ultra","zh":"旗舰版","hi":"अल्ट्रा","ar":"ألترا","pt":"Ultra","fr":"Ultra","de":"Ultra","ja":"ウルトラ","ru":"Ультра","id":"Ultra","bn":"আল্ট্রা","ur":"الٹرا","tr":"Ultra","vi":"Ultra","it":"Ultra","ko":"울트라","ta":"அல்ட்ரா"},"Custom":{"es":"Personalizado","zh":"定制","hi":"कस्टम","ar":"مخصص","pt":"Personalizado","fr":"Personnalisé","de":"Individuell","ja":"カスタム","ru":"Свой","id":"Kustom","bn":"কাস্টম","ur":"حسب ضرورت","tr":"Özel","vi":"Tùy chỉnh","it":"Personalizzato","ko":"맞춤","ta":"தனிப்பயன்"},"Most Popular":{"es":"Más popular","zh":"最受欢迎","hi":"सबसे लोकप्रिय","ar":"الأكثر شيوعاً","pt":"Mais popular","fr":"Le plus populaire","de":"Am beliebtesten","ja":"人気No.1","ru":"Популярный","id":"Terpopuler","bn":"সবচেয়ে জনপ্রিয়","ur":"سب سے مقبول","tr":"En popüler","vi":"Phổ biến nhất","it":"Più popolare","ko":"가장 인기","ta":"மிகவும் பிரபலம்"},"Most popular":{"es":"Más popular","zh":"最受欢迎","hi":"सबसे लोकप्रिय","ar":"الأكثر شيوعاً","pt":"Mais popular","fr":"Le plus populaire","de":"Am beliebtesten","ja":"人気No.1","ru":"Популярный","id":"Terpopuler","bn":"সবচেয়ে জনপ্রিয়","ur":"سب سے مقبول","tr":"En popüler","vi":"Phổ biến nhất","it":"Più popolare","ko":"가장 인기","ta":"மிகவும் பிரபலம்"},"Best Value":{"es":"Mejor valor","zh":"超值之选","hi":"सर्वोत्तम मूल्य","ar":"أفضل قيمة","pt":"Melhor valor","fr":"Meilleur rapport","de":"Bestes Angebot","ja":"お買い得","ru":"Выгодно","id":"Nilai terbaik","bn":"সেরা মূল্য","ur":"بہترین قیمت","tr":"En iyi değer","vi":"Giá trị nhất","it":"Miglior valore","ko":"최고 가치","ta":"சிறந்த மதிப்பு"},"Current plan":{"es":"Plan actual","zh":"当前套餐","hi":"वर्तमान योजना","ar":"الخطة الحالية","pt":"Plano atual","fr":"Forfait actuel","de":"Aktueller Tarif","ja":"現在のプラン","ru":"Текущий тариф","id":"Paket saat ini","bn":"বর্তমান প্ল্যান","ur":"موجودہ منصوبہ","tr":"Mevcut plan","vi":"Gói hiện tại","it":"Piano attuale","ko":"현재 요금제","ta":"தற்போதைய திட்டம்"},"Subscription":{"es":"Suscripción","zh":"订阅","hi":"सदस्यता","ar":"الاشتراك","pt":"Assinatura","fr":"Abonnement","de":"Abonnement","ja":"サブスク","ru":"Подписка","id":"Langganan","bn":"সাবস্ক্রিপশন","ur":"سبسکرپشن","tr":"Abonelik","vi":"Đăng ký","it":"Abbonamento","ko":"구독","ta":"சந்தா"},"Current usage":{"es":"Uso actual","zh":"当前用量","hi":"वर्तमान उपयोग","ar":"الاستخدام الحالي","pt":"Uso atual","fr":"Utilisation actuelle","de":"Aktuelle Nutzung","ja":"現在の使用量","ru":"Текущее использование","id":"Penggunaan saat ini","bn":"বর্তমান ব্যবহার","ur":"موجودہ استعمال","tr":"Mevcut kullanım","vi":"Sử dụng hiện tại","it":"Utilizzo attuale","ko":"현재 사용량","ta":"தற்போதைய பயன்பாடு"},"System status":{"es":"Estado del sistema","zh":"系统状态","hi":"सिस्टम स्थिति","ar":"حالة النظام","pt":"Status do sistema","fr":"État du système","de":"Systemstatus","ja":"システム状態","ru":"Статус системы","id":"Status sistem","bn":"সিস্টেম স্ট্যাটাস","ur":"سسٹم اسٹیٹس","tr":"Sistem durumu","vi":"Trạng thái hệ thống","it":"Stato del sistema","ko":"시스템 상태","ta":"கணினி நிலை"},"Keyboard shortcuts":{"es":"Atajos de teclado","zh":"键盘快捷键","hi":"कीबोर्ड शॉर्टकट","ar":"اختصارات لوحة المفاتيح","pt":"Atalhos de teclado","fr":"Raccourcis clavier","de":"Tastenkürzel","ja":"キーボードショートカット","ru":"Горячие клавиши","id":"Pintasan keyboard","bn":"কীবোর্ড শর্টকাট","ur":"کی بورڈ شارٹ کٹس","tr":"Klavye kısayolları","vi":"Phím tắt","it":"Scorciatoie da tastiera","ko":"키보드 단축키","ta":"விசைப்பலகை குறுக்குவழிகள்"},"Keyboard Shortcuts":{"es":"Atajos de teclado","zh":"键盘快捷键","hi":"कीबोर्ड शॉर्टकट","ar":"اختصارات لوحة المفاتيح","pt":"Atalhos de teclado","fr":"Raccourcis clavier","de":"Tastenkürzel","ja":"キーボードショートカット","ru":"Горячие клавиши","id":"Pintasan keyboard","bn":"কীবোর্ড শর্টকাট","ur":"کی بورڈ شارٹ کٹس","tr":"Klavye kısayolları","vi":"Phím tắt","it":"Scorciatoie da tastiera","ko":"키보드 단축키","ta":"விசைப்பலகை குறுக்குவழிகள்"},"New line":{"es":"Nueva línea","zh":"换行","hi":"नई पंक्ति","ar":"سطر جديد","pt":"Nova linha","fr":"Nouvelle ligne","de":"Neue Zeile","ja":"改行","ru":"Новая строка","id":"Baris baru","bn":"নতুন লাইন","ur":"نئی لائن","tr":"Yeni satır","vi":"Dòng mới","it":"Nuova riga","ko":"새 줄","ta":"புதிய வரி"},"Toggle sidebar":{"es":"Alternar barra lateral","zh":"切换侧栏","hi":"साइडबार टॉगल करें","ar":"تبديل الشريط الجانبي","pt":"Alternar barra lateral","fr":"Basculer la barre","de":"Seitenleiste umschalten","ja":"サイドバー切替","ru":"Боковая панель","id":"Alihkan bilah sisi","bn":"সাইডবার টগল","ur":"سائیڈبار ٹوگل","tr":"Kenar çubuğunu aç/kapat","vi":"Bật/tắt thanh bên","it":"Mostra/nascondi barra","ko":"사이드바 전환","ta":"பக்கப்பட்டியை மாற்று"},"What's New":{"es":"Novedades","zh":"新功能","hi":"नया क्या है","ar":"ما الجديد","pt":"Novidades","fr":"Nouveautés","de":"Neuigkeiten","ja":"新着情報","ru":"Что нового","id":"Yang baru","bn":"নতুন কী","ur":"نیا کیا ہے","tr":"Yenilikler","vi":"Có gì mới","it":"Novità","ko":"새로운 기능","ta":"புதியது என்ன"},"Page not found":{"es":"Página no encontrada","zh":"页面未找到","hi":"पृष्ठ नहीं मिला","ar":"الصفحة غير موجودة","pt":"Página não encontrada","fr":"Page introuvable","de":"Seite nicht gefunden","ja":"ページが見つかりません","ru":"Страница не найдена","id":"Halaman tidak ditemukan","bn":"পৃষ্ঠা পাওয়া যায়নি","ur":"صفحہ نہیں ملا","tr":"Sayfa bulunamadı","vi":"Không tìm thấy trang","it":"Pagina non trovata","ko":"페이지를 찾을 수 없음","ta":"பக்கம் கிடைக்கவில்லை"},"Help Center":{"es":"Centro de ayuda","zh":"帮助中心","hi":"सहायता केंद्र","ar":"مركز المساعدة","pt":"Central de ajuda","fr":"Centre d’aide","de":"Hilfecenter","ja":"ヘルプセンター","ru":"Центр помощи","id":"Pusat bantuan","bn":"সহায়তা কেন্দ্র","ur":"مدد مرکز","tr":"Yardım merkezi","vi":"Trung tâm trợ giúp","it":"Centro assistenza","ko":"도움말 센터","ta":"உதவி மையம்"},"Contact Support":{"es":"Contactar soporte","zh":"联系支持","hi":"सहायता से संपर्क करें","ar":"اتصل بالدعم","pt":"Contatar suporte","fr":"Contacter le support","de":"Support kontaktieren","ja":"サポートに連絡","ru":"Связаться с поддержкой","id":"Hubungi dukungan","bn":"সহায়তায় যোগাযোগ","ur":"سپورٹ سے رابطہ","tr":"Desteğe başvur","vi":"Liên hệ hỗ trợ","it":"Contatta assistenza","ko":"지원팀 문의","ta":"ஆதரவைத் தொடர்பு கொள்ளுங்கள்"},"Terms of Service":{"es":"Términos de servicio","zh":"服务条款","hi":"सेवा की शर्तें","ar":"شروط الخدمة","pt":"Termos de serviço","fr":"Conditions d’utilisation","de":"Nutzungsbedingungen","ja":"利用規約","ru":"Условия использования","id":"Ketentuan layanan","bn":"পরিষেবার শর্তাবলী","ur":"سروس کی شرائط","tr":"Hizmet şartları","vi":"Điều khoản dịch vụ","it":"Termini di servizio","ko":"서비스 약관","ta":"சேவை விதிமுறைகள்"},"Privacy Policy":{"es":"Política de privacidad","zh":"隐私政策","hi":"गोपनीयता नीति","ar":"سياسة الخصوصية","pt":"Política de privacidade","fr":"Politique de confidentialité","de":"Datenschutzrichtlinie","ja":"プライバシーポリシー","ru":"Политика конфиденциальности","id":"Kebijakan privasi","bn":"গোপনীয়তা নীতি","ur":"رازداری کی پالیسی","tr":"Gizlilik politikası","vi":"Chính sách bảo mật","it":"Informativa privacy","ko":"개인정보 처리방침","ta":"தனியுரிமைக் கொள்கை"},"Research":{"es":"Investigar","zh":"研究","hi":"अनुसंधान","ar":"بحث","pt":"Pesquisa","fr":"Recherche","de":"Recherche","ja":"リサーチ","ru":"Исследование","id":"Riset","bn":"গবেষণা","ur":"تحقیق","tr":"Araştırma","vi":"Nghiên cứu","it":"Ricerca","ko":"리서치","ta":"ஆராய்ச்சி"},"Code":{"es":"Código","zh":"代码","hi":"कोड","ar":"الكود","pt":"Código","fr":"Code","de":"Code","ja":"コード","ru":"Код","id":"Kode","bn":"কোড","ur":"کوڈ","tr":"Kod","vi":"Mã","it":"Codice","ko":"코드","ta":"குறியீடு"},"Files":{"es":"Archivos","zh":"文件","hi":"फ़ाइलें","ar":"الملفات","pt":"Arquivos","fr":"Fichiers","de":"Dateien","ja":"ファイル","ru":"Файлы","id":"File","bn":"ফাইল","ur":"فائلیں","tr":"Dosyalar","vi":"Tệp","it":"File","ko":"파일","ta":"கோப்புகள்"},"Style":{"es":"Estilo","zh":"风格","hi":"शैली","ar":"النمط","pt":"Estilo","fr":"Style","de":"Stil","ja":"スタイル","ru":"Стиль","id":"Gaya","bn":"স্টাইল","ur":"انداز","tr":"Stil","vi":"Phong cách","it":"Stile","ko":"스타일","ta":"பாணி"},"Duration":{"es":"Duración","zh":"时长","hi":"अवधि","ar":"المدة","pt":"Duração","fr":"Durée","de":"Dauer","ja":"長さ","ru":"Длительность","id":"Durasi","bn":"সময়কাল","ur":"دورانیہ","tr":"Süre","vi":"Thời lượng","it":"Durata","ko":"길이","ta":"கால அளவு"},"Output":{"es":"Salida","zh":"输出","hi":"आउटपुट","ar":"الناتج","pt":"Saída","fr":"Sortie","de":"Ausgabe","ja":"出力","ru":"Результат","id":"Keluaran","bn":"আউটপুট","ur":"آؤٹ پٹ","tr":"Çıktı","vi":"Đầu ra","it":"Output","ko":"출력","ta":"வெளியீடு"},"Preview":{"es":"Vista previa","zh":"预览","hi":"पूर्वावलोकन","ar":"معاينة","pt":"Prévia","fr":"Aperçu","de":"Vorschau","ja":"プレビュー","ru":"Просмотр","id":"Pratinjau","bn":"প্রিভিউ","ur":"پیش نظارہ","tr":"Önizleme","vi":"Xem trước","it":"Anteprima","ko":"미리보기","ta":"முன்னோட்டம்"},"Earnings":{"es":"Ganancias","zh":"收入","hi":"कमाई","ar":"الأرباح","pt":"Ganhos","fr":"Revenus","de":"Einnahmen","ja":"収益","ru":"Доход","id":"Penghasilan","bn":"আয়","ur":"کمائی","tr":"Kazançlar","vi":"Thu nhập","it":"Guadagni","ko":"수익","ta":"வருவாய்"},"Finance":{"es":"Finanzas","zh":"财务","hi":"वित्त","ar":"المالية","pt":"Finanças","fr":"Finances","de":"Finanzen","ja":"財務","ru":"Финансы","id":"Keuangan","bn":"অর্থ","ur":"مالیات","tr":"Finans","vi":"Tài chính","it":"Finanza","ko":"재무","ta":"நிதி"},"Dashboard":{"es":"Panel","zh":"仪表板","hi":"डैशबोर्ड","ar":"لوحة القيادة","pt":"Painel","fr":"Tableau de bord","de":"Übersicht","ja":"ダッシュボード","ru":"Панель","id":"Dasbor","bn":"ড্যাশবোর্ড","ur":"ڈیش بورڈ","tr":"Kontrol paneli","vi":"Bảng điều khiển","it":"Dashboard","ko":"대시보드","ta":"டாஷ்போர்டு"},"Messages":{"es":"Mensajes","zh":"消息","hi":"संदेश","ar":"الرسائل","pt":"Mensagens","fr":"Messages","de":"Nachrichten","ja":"メッセージ","ru":"Сообщения","id":"Pesan","bn":"বার্তা","ur":"پیغامات","tr":"Mesajlar","vi":"Tin nhắn","it":"Messaggi","ko":"메시지","ta":"செய்திகள்"},"Sessions":{"es":"Sesiones","zh":"会话","hi":"सत्र","ar":"الجلسات","pt":"Sessões","fr":"Sessions","de":"Sitzungen","ja":"セッション","ru":"Сессии","id":"Sesi","bn":"সেশন","ur":"سیشنز","tr":"Oturumlar","vi":"Phiên","it":"Sessioni","ko":"세션","ta":"அமர்வுகள்"},"Active":{"es":"Activo","zh":"活跃","hi":"सक्रिय","ar":"نشط","pt":"Ativo","fr":"Actif","de":"Aktiv","ja":"アクティブ","ru":"Активно","id":"Aktif","bn":"সক্রিয়","ur":"فعال","tr":"Aktif","vi":"Đang hoạt động","it":"Attivo","ko":"활성","ta":"செயலில்"},"Incoming":{"es":"Entrante","zh":"传入","hi":"आवक","ar":"وارد","pt":"Recebido","fr":"Entrant","de":"Eingehend","ja":"受信","ru":"Входящие","id":"Masuk","bn":"আগত","ur":"آنے والا","tr":"Gelen","vi":"Đến","it":"In arrivo","ko":"수신","ta":"உள்வரும்"},"Sent":{"es":"Enviado","zh":"已发送","hi":"भेजा गया","ar":"مرسل","pt":"Enviado","fr":"Envoyé","de":"Gesendet","ja":"送信済み","ru":"Отправлено","id":"Terkirim","bn":"পাঠানো হয়েছে","ur":"بھیجا گیا","tr":"Gönderildi","vi":"Đã gửi","it":"Inviato","ko":"전송됨","ta":"அனுப்பப்பட்டது"},"Newest":{"es":"Más reciente","zh":"最新","hi":"नवीनतम","ar":"الأحدث","pt":"Mais recente","fr":"Le plus récent","de":"Neueste","ja":"最新","ru":"Новейшие","id":"Terbaru","bn":"নতুনতম","ur":"تازہ ترین","tr":"En yeni","vi":"Mới nhất","it":"Più recente","ko":"최신","ta":"புதியது"},"Best rated":{"es":"Mejor valorado","zh":"评分最高","hi":"सर्वोत्तम रेटेड","ar":"الأعلى تقييماً","pt":"Melhor avaliado","fr":"Les mieux notés","de":"Bestbewertet","ja":"高評価","ru":"Лучшие","id":"Rating tertinggi","bn":"সেরা রেটেড","ur":"بہترین درجہ","tr":"En yüksek puanlı","vi":"Đánh giá cao nhất","it":"Più votati","ko":"평점 높은순","ta":"சிறந்த மதிப்பீடு"},"Top sellers":{"es":"Más vendidos","zh":"热销","hi":"शीर्ष विक्रेता","ar":"الأكثر مبيعاً","pt":"Mais vendidos","fr":"Meilleures ventes","de":"Bestseller","ja":"売れ筋","ru":"Хиты продаж","id":"Terlaris","bn":"সেরা বিক্রেতা","ur":"ٹاپ سیلرز","tr":"En çok satanlar","vi":"Bán chạy nhất","it":"Più venduti","ko":"베스트셀러","ta":"அதிக விற்பனை"},"My purchases":{"es":"Mis compras","zh":"我的购买","hi":"मेरी खरीदारी","ar":"مشترياتي","pt":"Minhas compras","fr":"Mes achats","de":"Meine Käufe","ja":"購入履歴","ru":"Мои покупки","id":"Pembelian saya","bn":"আমার কেনাকাটা","ur":"میری خریداری","tr":"Satın aldıklarım","vi":"Đơn mua của tôi","it":"I miei acquisti","ko":"내 구매","ta":"எனது கொள்முதல்கள்"},"Personal":{"es":"Personal","zh":"个人","hi":"व्यक्तिगत","ar":"شخصي","pt":"Pessoal","fr":"Personnel","de":"Persönlich","ja":"個人","ru":"Личное","id":"Pribadi","bn":"ব্যক্তিগত","ur":"ذاتی","tr":"Kişisel","vi":"Cá nhân","it":"Personale","ko":"개인","ta":"தனிப்பட்ட"},"Business":{"es":"Empresa","zh":"商业","hi":"व्यवसाय","ar":"الأعمال","pt":"Negócios","fr":"Entreprise","de":"Unternehmen","ja":"ビジネス","ru":"Бизнес","id":"Bisnis","bn":"ব্যবসা","ur":"کاروبار","tr":"İşletme","vi":"Doanh nghiệp","it":"Azienda","ko":"비즈니스","ta":"வணிகம்"},"Marketing":{"es":"Marketing","zh":"营销","hi":"मार्केटिंग","ar":"التسويق","pt":"Marketing","fr":"Marketing","de":"Marketing","ja":"マーケティング","ru":"Маркетинг","id":"Pemasaran","bn":"মার্কেটিং","ur":"مارکیٹنگ","tr":"Pazarlama","vi":"Tiếp thị","it":"Marketing","ko":"마케팅","ta":"சந்தைப்படுத்தல்"},"Sales":{"es":"Ventas","zh":"销售","hi":"बिक्री","ar":"المبيعات","pt":"Vendas","fr":"Ventes","de":"Vertrieb","ja":"営業","ru":"Продажи","id":"Penjualan","bn":"বিক্রয়","ur":"فروخت","tr":"Satış","vi":"Bán hàng","it":"Vendite","ko":"영업","ta":"விற்பனை"},"Education":{"es":"Educación","zh":"教育","hi":"शिक्षा","ar":"التعليم","pt":"Educação","fr":"Éducation","de":"Bildung","ja":"教育","ru":"Образование","id":"Pendidikan","bn":"শিক্ষা","ur":"تعلیم","tr":"Eğitim","vi":"Giáo dục","it":"Istruzione","ko":"교육","ta":"கல்வி"},"Productivity":{"es":"Productividad","zh":"生产力","hi":"उत्पादकता","ar":"الإنتاجية","pt":"Produtividade","fr":"Productivité","de":"Produktivität","ja":"生産性","ru":"Продуктивность","id":"Produktivitas","bn":"উৎপাদনশীলতা","ur":"پیداواری صلاحیت","tr":"Üretkenlik","vi":"Năng suất","it":"Produttività","ko":"생산성","ta":"உற்பத்தித்திறன்"},"Developer":{"es":"Desarrollador","zh":"开发者","hi":"डेवलपर","ar":"المطور","pt":"Desenvolvedor","fr":"Développeur","de":"Entwickler","ja":"開発者","ru":"Разработчик","id":"Pengembang","bn":"ডেভেলপার","ur":"ڈیولپر","tr":"Geliştirici","vi":"Nhà phát triển","it":"Sviluppatore","ko":"개발자","ta":"டெவலப்பர்"},"Student":{"es":"Estudiante","zh":"学生","hi":"छात्र","ar":"طالب","pt":"Estudante","fr":"Étudiant","de":"Student","ja":"学生","ru":"Студент","id":"Pelajar","bn":"ছাত্র","ur":"طالب علم","tr":"Öğrenci","vi":"Sinh viên","it":"Studente","ko":"학생","ta":"மாணவர்"},"Work":{"es":"Trabajo","zh":"工作","hi":"काम","ar":"العمل","pt":"Trabalho","fr":"Travail","de":"Arbeit","ja":"仕事","ru":"Работа","id":"Kerja","bn":"কাজ","ur":"کام","tr":"İş","vi":"Công việc","it":"Lavoro","ko":"업무","ta":"வேலை"},"Auto":{"es":"Auto","zh":"自动","hi":"ऑटो","ar":"تلقائي","pt":"Auto","fr":"Auto","de":"Auto","ja":"自動","ru":"Авто","id":"Otomatis","bn":"অটো","ur":"آٹو","tr":"Otomatik","vi":"Tự động","it":"Auto","ko":"자동","ta":"தானி"},"Auto-detect":{"es":"Autodetectar","zh":"自动检测","hi":"स्वतः पहचान","ar":"كشف تلقائي","pt":"Detectar automaticamente","fr":"Détection auto","de":"Automatisch erkennen","ja":"自動検出","ru":"Автоопределение","id":"Deteksi otomatis","bn":"স্বয়ংক্রিয় সনাক্তকরণ","ur":"خودکار شناخت","tr":"Otomatik algıla","vi":"Tự động phát hiện","it":"Rilevamento automatico","ko":"자동 감지","ta":"தானாக கண்டறி"},"Response language":{"es":"Idioma de respuesta","zh":"回复语言","hi":"उत्तर भाषा","ar":"لغة الرد","pt":"Idioma da resposta","fr":"Langue de réponse","de":"Antwortsprache","ja":"応答言語","ru":"Язык ответа","id":"Bahasa respons","bn":"উত্তরের ভাষা","ur":"جواب کی زبان","tr":"Yanıt dili","vi":"Ngôn ngữ trả lời","it":"Lingua di risposta","ko":"응답 언어","ta":"பதில் மொழி"},"Reduce animation":{"es":"Reducir animación","zh":"减少动画","hi":"एनिमेशन कम करें","ar":"تقليل الحركة","pt":"Reduzir animação","fr":"Réduire l’animation","de":"Animation reduzieren","ja":"アニメーション低減","ru":"Меньше анимации","id":"Kurangi animasi","bn":"অ্যানিমেশন কমান","ur":"اینیمیشن کم کریں","tr":"Animasyonu azalt","vi":"Giảm hiệu ứng","it":"Riduci animazioni","ko":"애니메이션 줄이기","ta":"அசைவூட்டத்தைக் குறை"},"Motion":{"es":"Movimiento","zh":"动效","hi":"मोशन","ar":"الحركة","pt":"Movimento","fr":"Mouvement","de":"Bewegung","ja":"モーション","ru":"Движение","id":"Gerak","bn":"মোশন","ur":"حرکت","tr":"Hareket","vi":"Chuyển động","it":"Movimento","ko":"모션","ta":"அசைவு"},"Default":{"es":"Predeterminado","zh":"默认","hi":"डिफ़ॉल्ट","ar":"افتراضي","pt":"Padrão","fr":"Par défaut","de":"Standard","ja":"デフォルト","ru":"По умолчанию","id":"Default","bn":"ডিফল্ট","ur":"ڈیفالٹ","tr":"Varsayılan","vi":"Mặc định","it":"Predefinito","ko":"기본값","ta":"இயல்புநிலை"},"Controls":{"es":"Controles","zh":"控制","hi":"नियंत्रण","ar":"التحكم","pt":"Controles","fr":"Contrôles","de":"Steuerung","ja":"コントロール","ru":"Управление","id":"Kontrol","bn":"নিয়ন্ত্রণ","ur":"کنٹرولز","tr":"Kontroller","vi":"Điều khiển","it":"Controlli","ko":"컨트롤","ta":"கட்டுப்பாடுகள்"},"Aspect":{"es":"Aspecto","zh":"比例","hi":"पहलू","ar":"النسبة","pt":"Proporção","fr":"Format","de":"Seitenverhältnis","ja":"アスペクト","ru":"Соотношение","id":"Aspek","bn":"অনুপাত","ur":"تناسب","tr":"En boy oranı","vi":"Tỷ lệ","it":"Proporzioni","ko":"비율","ta":"விகிதம்"},"Ratio":{"es":"Proporción","zh":"比例","hi":"अनुपात","ar":"النسبة","pt":"Proporção","fr":"Ratio","de":"Verhältnis","ja":"比率","ru":"Соотношение","id":"Rasio","bn":"অনুপাত","ur":"تناسب","tr":"Oran","vi":"Tỷ lệ","it":"Rapporto","ko":"비율","ta":"விகிதம்"},"Mood":{"es":"Ambiente","zh":"氛围","hi":"मूड","ar":"المزاج","pt":"Clima","fr":"Ambiance","de":"Stimmung","ja":"ムード","ru":"Настроение","id":"Suasana","bn":"মেজাজ","ur":"موڈ","tr":"Ruh hali","vi":"Tâm trạng","it":"Atmosfera","ko":"분위기","ta":"மனநிலை"},"Presets":{"es":"Preajustes","zh":"预设","hi":"प्रीसेट","ar":"الإعدادات المسبقة","pt":"Predefinições","fr":"Préréglages","de":"Voreinstellungen","ja":"プリセット","ru":"Пресеты","id":"Preset","bn":"প্রিসেট","ur":"پیش سیٹ","tr":"Ön ayarlar","vi":"Cài đặt sẵn","it":"Preset","ko":"프리셋","ta":"முன்னமைவுகள்"},"Your data":{"es":"Tus datos","zh":"你的数据","hi":"आपका डेटा","ar":"بياناتك","pt":"Seus dados","fr":"Vos données","de":"Ihre Daten","ja":"あなたのデータ","ru":"Ваши данные","id":"Data Anda","bn":"আপনার ডেটা","ur":"آپ کا ڈیٹا","tr":"Verileriniz","vi":"Dữ liệu của bạn","it":"I tuoi dati","ko":"내 데이터","ta":"உங்கள் தரவு"},"Your name":{"es":"Tu nombre","zh":"你的名字","hi":"आपका नाम","ar":"اسمك","pt":"Seu nome","fr":"Votre nom","de":"Ihr Name","ja":"あなたの名前","ru":"Ваше имя","id":"Nama Anda","bn":"আপনার নাম","ur":"آپ کا نام","tr":"Adınız","vi":"Tên của bạn","it":"Il tuo nome","ko":"이름","ta":"உங்கள் பெயர்"},"Your impact":{"es":"Tu impacto","zh":"你的成果","hi":"आपका प्रभाव","ar":"تأثيرك","pt":"Seu impacto","fr":"Votre impact","de":"Ihre Wirkung","ja":"あなたの成果","ru":"Ваш вклад","id":"Dampak Anda","bn":"আপনার প্রভাব","ur":"آپ کا اثر","tr":"Etkiniz","vi":"Tác động của bạn","it":"Il tuo impatto","ko":"내 영향","ta":"உங்கள் தாக்கம்"},"Your skills":{"es":"Tus habilidades","zh":"你的技能","hi":"आपके कौशल","ar":"مهاراتك","pt":"Suas habilidades","fr":"Vos compétences","de":"Ihre Fähigkeiten","ja":"あなたのスキル","ru":"Ваши навыки","id":"Keterampilan Anda","bn":"আপনার দক্ষতা","ur":"آپ کی مہارتیں","tr":"Becerileriniz","vi":"Kỹ năng của bạn","it":"Le tue competenze","ko":"내 스킬","ta":"உங்கள் திறன்கள்"},"Your messages":{"es":"Tus mensajes","zh":"你的消息","hi":"आपके संदेश","ar":"رسائلك","pt":"Suas mensagens","fr":"Vos messages","de":"Ihre Nachrichten","ja":"あなたのメッセージ","ru":"Ваши сообщения","id":"Pesan Anda","bn":"আপনার বার্তা","ur":"آپ کے پیغامات","tr":"Mesajlarınız","vi":"Tin nhắn của bạn","it":"I tuoi messaggi","ko":"내 메시지","ta":"உங்கள் செய்திகள்"},"Recurring work":{"es":"Trabajo recurrente","zh":"周期性工作","hi":"आवर्ती कार्य","ar":"عمل متكرر","pt":"Trabalho recorrente","fr":"Travail récurrent","de":"Wiederkehrende Arbeit","ja":"定期作業","ru":"Повторяющаяся работа","id":"Kerja berulang","bn":"পুনরাবৃত্ত কাজ","ur":"بار بار کام","tr":"Yinelenen iş","vi":"Công việc định kỳ","it":"Lavoro ricorrente","ko":"반복 작업","ta":"தொடர் வேலை"},"Scheduled work":{"es":"Trabajo programado","zh":"计划工作","hi":"निर्धारित कार्य","ar":"عمل مجدول","pt":"Trabalho agendado","fr":"Travail planifié","de":"Geplante Arbeit","ja":"予約作業","ru":"Запланированная работа","id":"Kerja terjadwal","bn":"নির্ধারিত কাজ","ur":"شیڈول شدہ کام","tr":"Zamanlanmış iş","vi":"Công việc đã lên lịch","it":"Lavoro pianificato","ko":"예약 작업","ta":"திட்டமிட்ட வேலை"},"Add Memory":{"es":"Añadir memoria","zh":"添加记忆","hi":"स्मृति जोड़ें","ar":"إضافة ذاكرة","pt":"Adicionar memória","fr":"Ajouter une mémoire","de":"Speicher hinzufügen","ja":"メモリを追加","ru":"Добавить память","id":"Tambah memori","bn":"স্মৃতি যোগ করুন","ur":"یادداشت شامل کریں","tr":"Bellek ekle","vi":"Thêm bộ nhớ","it":"Aggiungi memoria","ko":"메모리 추가","ta":"நினைவகம் சேர்"},"Open memory":{"es":"Abrir memoria","zh":"打开记忆","hi":"स्मृति खोलें","ar":"فتح الذاكرة","pt":"Abrir memória","fr":"Ouvrir la mémoire","de":"Speicher öffnen","ja":"メモリを開く","ru":"Открыть память","id":"Buka memori","bn":"স্মৃতি খুলুন","ur":"یادداشت کھولیں","tr":"Belleği aç","vi":"Mở bộ nhớ","it":"Apri memoria","ko":"메모리 열기","ta":"நினைவகத்தைத் திற"},"Clear chats":{"es":"Borrar chats","zh":"清除对话","hi":"चैट साफ़ करें","ar":"مسح المحادثات","pt":"Limpar conversas","fr":"Effacer les chats","de":"Chats löschen","ja":"チャットを消去","ru":"Очистить чаты","id":"Hapus obrolan","bn":"চ্যাট সাফ করুন","ur":"چیٹس صاف کریں","tr":"Sohbetleri temizle","vi":"Xóa trò chuyện","it":"Cancella chat","ko":"채팅 지우기","ta":"அரட்டைகளை அழி"},"Remove photo":{"es":"Quitar foto","zh":"移除照片","hi":"फ़ोटो हटाएँ","ar":"إزالة الصورة","pt":"Remover foto","fr":"Supprimer la photo","de":"Foto entfernen","ja":"写真を削除","ru":"Удалить фото","id":"Hapus foto","bn":"ছবি সরান","ur":"تصویر ہٹائیں","tr":"Fotoğrafı kaldır","vi":"Xóa ảnh","it":"Rimuovi foto","ko":"사진 제거","ta":"புகைப்படத்தை அகற்று"},"Try it →":{"es":"Pruébalo →","zh":"试试 →","hi":"आज़माएँ →","ar":"جرّبه →","pt":"Experimente →","fr":"Essayez →","de":"Ausprobieren →","ja":"試す →","ru":"Попробовать →","id":"Coba →","bn":"চেষ্টা করুন →","ur":"آزمائیں →","tr":"Deneyin →","vi":"Thử ngay →","it":"Provalo →","ko":"사용해보기 →","ta":"முயற்சி →"},"Get started free":{"es":"Comienza gratis","zh":"免费开始","hi":"मुफ़्त शुरू करें","ar":"ابدأ مجاناً","pt":"Comece grátis","fr":"Commencer gratuitement","de":"Kostenlos starten","ja":"無料で始める","ru":"Начать бесплатно","id":"Mulai gratis","bn":"ফ্রি শুরু করুন","ur":"مفت شروع کریں","tr":"Ücretsiz başla","vi":"Bắt đầu miễn phí","it":"Inizia gratis","ko":"무료로 시작","ta":"இலவசமாகத் தொடங்கு"}};for(var k in __D){if(!I18N[k])I18N[k]=__D[k];else{for(var lc in __D[k]){if(!I18N[k][lc])I18N[k][lc]=__D[k][lc];}}}}catch(e){}})();
/* Fold the core UI translation dictionary (i18n-dict.js, inlined here so the
   single-file build needs no extra script) into I18N. Only ADD keys that are
   not already present, so the hand-tuned inline entries always win. This is
   what makes more of the chrome translate WITHOUT an API key. */
/* ============================================================
   AMV UI TRANSLATION DICTIONARY
   Covers the core UI vocabulary in all 19 supported languages so
   the interface switches fully WITHOUT needing an API key. Keys are
   the exact English UI strings; each value maps lang-code → translation.
   Order of languages per entry:
   es zh hi ar pt fr de ja ru id bn ur tr vi it ko ta
   (en/auto use the key itself.)
   Merged into the runtime I18N object at load.
   ============================================================ */
(function(){
  // helper: build an entry from a positional array
  const L = ['es','zh','hi','ar','pt','fr','de','ja','ru','id','bn','ur','tr','vi','it','ko','ta'];
  function E(){ const a=arguments; const o={}; for(let i=0;i<L.length;i++){ if(a[i]) o[L[i]]=a[i]; } return o; }

  const D = {
    // ---- Primary navigation ----
    'Chat':            E('Chat','聊天','चैट','الدردشة','Conversa','Discussion','Chat','チャット','Чат','Obrolan','চ্যাট','چیٹ','Sohbet','Trò chuyện','Chat','채팅','அரட்டை'),
    'Images':          E('Imágenes','图片','छवियाँ','الصور','Imagens','Images','Bilder','画像','Изображения','Gambar','ছবি','تصاویر','Görseller','Hình ảnh','Immagini','이미지','படங்கள்'),
    'Video':           E('Vídeo','视频','वीडियो','الفيديو','Vídeo','Vidéo','Video','動画','Видео','Video','ভিডিও','ویڈیو','Video','Video','Video','비디오','வீடியோ'),
    'Crew':            E('Equipo','团队','दल','الطاقم','Equipe','Équipe','Team','クルー','Команда','Kru','ক্রু','عملہ','Ekip','Nhóm','Squadra','크루','குழு'),
    'Handoff':         E('Transferir','交接','सौंपना','التسليم','Transferir','Transfert','Übergabe','引き継ぎ','Передача','Serah','হস্তান্তর','حوالگی','Devir','Bàn giao','Passaggio','핸드오프','ஒப்படைப்பு'),
    'Studio':          E('Estudio','工作室','स्टूडियो','الاستوديو','Estúdio','Studio','Studio','スタジオ','Студия','Studio','স্টুডিও','اسٹوڈیو','Stüdyo','Studio','Studio','스튜디오','ஸ்டுடியோ'),
    'Dev':             E('Dev','开发','डेव','المطور','Dev','Dev','Dev','開発','Разработка','Dev','ডেভ','ڈیو','Dev','Dev','Dev','개발','டெவ்'),
    'Lab':             E('Laboratorio','实验室','लैब','المختبر','Laboratório','Labo','Labor','ラボ','Лаборатория','Lab','ল্যাব','لیب','Lab','Phòng thí nghiệm','Laboratorio','랩','ஆய்வகம்'),
    'Projects':        E('Proyectos','项目','परियोजनाएँ','المشاريع','Projetos','Projets','Projekte','プロジェクト','Проекты','Proyek','প্রকল্প','منصوبے','Projeler','Dự án','Progetti','프로젝트','திட்டங்கள்'),
    'Memory':          E('Memoria','记忆','स्मृति','الذاكرة','Memória','Mémoire','Speicher','メモリ','Память','Memori','স্মৃতি','یادداشت','Bellek','Bộ nhớ','Memoria','메모리','நினைவகம்'),
    'Tasks':           E('Tareas','任务','कार्य','المهام','Tarefas','Tâches','Aufgaben','タスク','Задачи','Tugas','কাজ','کام','Görevler','Nhiệm vụ','Attività','작업','பணிகள்'),
    'Marketplace':     E('Mercado','市场','मार्केटप्लेस','السوق','Mercado','Marché','Marktplatz','マーケット','Маркет','Pasar','মার্কেটপ্লেস','مارکیٹ','Pazar','Chợ','Mercato','마켓플레이스','சந்தை'),
    'Plans':           E('Planes','套餐','योजनाएँ','الخطط','Planos','Forfaits','Tarife','プラン','Тарифы','Paket','প্ল্যান','منصوبے','Planlar','Gói','Piani','요금제','திட்டங்கள்'),

    // ---- Section eyebrows ----
    'Create':          E('Crear','创作','बनाएँ','إنشاء','Criar','Créer','Erstellen','作成','Создать','Buat','তৈরি করুন','بنائیں','Oluştur','Tạo','Crea','만들기','உருவாக்கு'),
    'Agents':          E('Agentes','智能体','एजेंट','الوكلاء','Agentes','Agents','Agenten','エージェント','Агенты','Agen','এজেন্ট','ایجنٹس','Ajanlar','Tác nhân','Agenti','에이전트','முகவர்கள்'),
    'Build':           E('Construir','构建','निर्माण','بناء','Construir','Construire','Erstellen','ビルド','Сборка','Bangun','নির্মাণ','تعمیر','Oluştur','Xây dựng','Costruisci','빌드','உருவாக்கு'),
    'Workspace':       E('Espacio','工作区','कार्यस्थान','مساحة العمل','Espaço','Espace','Arbeitsbereich','ワークスペース','Рабочая область','Ruang kerja','কর্মক্ষেত্র','ورک اسپیس','Çalışma alanı','Không gian làm việc','Area di lavoro','작업 공간','பணியிடம்'),
    'Recents':         E('Recientes','最近','हाल के','الأخيرة','Recentes','Récents','Kürzlich','最近','Недавние','Terbaru','সাম্প্রতিক','حالیہ','Son kullanılanlar','Gần đây','Recenti','최근','சமீபத்தியவை'),
    'General':         E('General','通用','सामान्य','عام','Geral','Général','Allgemein','一般','Общие','Umum','সাধারণ','عام','Genel','Chung','Generale','일반','பொது'),
    'Customize':       E('Personalizar','自定义','अनुकूलित','تخصيص','Personalizar','Personnaliser','Anpassen','カスタマイズ','Настроить','Sesuaikan','কাস্টমাইজ','حسب ضرورت','Özelleştir','Tùy chỉnh','Personalizza','맞춤 설정','தனிப்பயனாக்கு'),

    // ---- Common actions / buttons ----
    'New chat':        E('Nueva conversación','新对话','नई चैट','محادثة جديدة','Nova conversa','Nouvelle discussion','Neuer Chat','新しいチャット','Новый чат','Obrolan baru','নতুন চ্যাট','نئی چیٹ','Yeni sohbet','Trò chuyện mới','Nuova chat','새 채팅','புதிய அரட்டை'),
    'New project':     E('Nuevo proyecto','新项目','नई परियोजना','مشروع جديد','Novo projeto','Nouveau projet','Neues Projekt','新規プロジェクト','Новый проект','Proyek baru','নতুন প্রকল্প','نیا منصوبہ','Yeni proje','Dự án mới','Nuovo progetto','새 프로젝트','புதிய திட்டம்'),
    'New session':     E('Nueva sesión','新会话','नया सत्र','جلسة جديدة','Nova sessão','Nouvelle session','Neue Sitzung','新しいセッション','Новая сессия','Sesi baru','নতুন সেশন','نیا سیشن','Yeni oturum','Phiên mới','Nuova sessione','새 세션','புதிய அமர்வு'),
    'Generate':        E('Generar','生成','उत्पन्न करें','إنشاء','Gerar','Générer','Generieren','生成','Создать','Hasilkan','তৈরি করুন','بنائیں','Oluştur','Tạo','Genera','생성','உருவாக்கு'),
    'Send':            E('Enviar','发送','भेजें','إرسال','Enviar','Envoyer','Senden','送信','Отправить','Kirim','পাঠান','بھیجیں','Gönder','Gửi','Invia','보내기','அனுப்பு'),
    'Send message':    E('Enviar mensaje','发送消息','संदेश भेजें','إرسال رسالة','Enviar mensagem','Envoyer le message','Nachricht senden','メッセージを送信','Отправить сообщение','Kirim pesan','বার্তা পাঠান','پیغام بھیجیں','Mesaj gönder','Gửi tin nhắn','Invia messaggio','메시지 보내기','செய்தி அனுப்பு'),
    'Run':             E('Ejecutar','运行','चलाएँ','تشغيل','Executar','Exécuter','Ausführen','実行','Запустить','Jalankan','চালান','چلائیں','Çalıştır','Chạy','Esegui','실행','இயக்கு'),
    'Write':           E('Escribir','写作','लिखें','كتابة','Escrever','Écrire','Schreiben','書く','Написать','Tulis','লিখুন','لکھیں','Yaz','Viết','Scrivi','작성','எழுது'),
    'Browse':          E('Explorar','浏览','ब्राउज़ करें','تصفح','Navegar','Parcourir','Durchsuchen','閲覧','Обзор','Jelajahi','ব্রাউজ করুন','براؤز کریں','Gözat','Duyệt','Sfoglia','둘러보기','உலாவு'),
    'Sell':            E('Vender','出售','बेचें','بيع','Vender','Vendre','Verkaufen','販売','Продать','Jual','বিক্রি','بیچیں','Sat','Bán','Vendi','판매','விற்பனை'),
    'Connect':         E('Conectar','连接','कनेक्ट करें','ربط','Conectar','Connecter','Verbinden','接続','Подключить','Hubungkan','সংযোগ করুন','جوڑیں','Bağlan','Kết nối','Connetti','연결','இணை'),
    'Manage':          E('Gestionar','管理','प्रबंधित करें','إدارة','Gerenciar','Gérer','Verwalten','管理','Управлять','Kelola','পরিচালনা','نظم کریں','Yönet','Quản lý','Gestisci','관리','நிர்வகி'),
    'Automate':        E('Automatizar','自动化','स्वचालित करें','أتمتة','Automatizar','Automatiser','Automatisieren','自動化','Автоматизировать','Otomatiskan','স্বয়ংক্রিয়','خودکار','Otomatikleştir','Tự động hóa','Automatizza','자동화','தானியக்கம்'),
    'Save changes':    E('Guardar cambios','保存更改','परिवर्तन सहेजें','حفظ التغييرات','Salvar alterações','Enregistrer','Änderungen speichern','変更を保存','Сохранить','Simpan perubahan','পরিবর্তন সংরক্ষণ','تبدیلیاں محفوظ کریں','Değişiklikleri kaydet','Lưu thay đổi','Salva modifiche','변경 사항 저장','மாற்றங்களைச் சேமி'),
    'Close':           E('Cerrar','关闭','बंद करें','إغلاق','Fechar','Fermer','Schließen','閉じる','Закрыть','Tutup','বন্ধ করুন','بند کریں','Kapat','Đóng','Chiudi','닫기','மூடு'),
    'More':            E('Más','更多','और','المزيد','Mais','Plus','Mehr','もっと','Ещё','Lainnya','আরও','مزید','Daha fazla','Thêm','Altro','더 보기','மேலும்'),
    'All':             E('Todos','全部','सभी','الكل','Todos','Tous','Alle','すべて','Все','Semua','সব','سب','Tümü','Tất cả','Tutti','전체','அனைத்தும்'),
    'Attach file':     E('Adjuntar archivo','附加文件','फ़ाइल संलग्न करें','إرفاق ملف','Anexar arquivo','Joindre un fichier','Datei anhängen','ファイルを添付','Прикрепить файл','Lampirkan file','ফাইল সংযুক্ত করুন','فائل منسلک کریں','Dosya ekle','Đính kèm tệp','Allega file','파일 첨부','கோப்பை இணை'),
    'Voice input':     E('Entrada de voz','语音输入','आवाज़ इनपुट','إدخال صوتي','Entrada de voz','Entrée vocale','Spracheingabe','音声入力','Голосовой ввод','Input suara','ভয়েস ইনপুট','صوتی ان پٹ','Sesli giriş','Nhập bằng giọng nói','Input vocale','음성 입력','குரல் உள்ளீடு'),
    'Web search':      E('Búsqueda web','网页搜索','वेब खोज','بحث الويب','Busca na web','Recherche web','Websuche','ウェブ検索','Веб-поиск','Pencarian web','ওয়েব অনুসন্ধান','ویب تلاش','Web araması','Tìm kiếm web','Ricerca web','웹 검색','வலைத் தேடல்'),

    // ---- Settings & account ----
    'Settings':        E('Ajustes','设置','सेटिंग्स','الإعدادات','Configurações','Paramètres','Einstellungen','設定','Настройки','Pengaturan','সেটিংস','ترتیبات','Ayarlar','Cài đặt','Impostazioni','설정','அமைப்புகள்'),
    'Account':         E('Cuenta','账户','खाता','الحساب','Conta','Compte','Konto','アカウント','Аккаунт','Akun','অ্যাকাউন্ট','اکاؤنٹ','Hesap','Tài khoản','Account','계정','கணக்கு'),
    'Privacy':         E('Privacidad','隐私','गोपनीयता','الخصوصية','Privacidade','Confidentialité','Datenschutz','プライバシー','Конфиденциальность','Privasi','গোপনীয়তা','رازداری','Gizlilik','Quyền riêng tư','Privacy','개인정보','தனியுரிமை'),
    'Security':        E('Seguridad','安全','सुरक्षा','الأمان','Segurança','Sécurité','Sicherheit','セキュリティ','Безопасность','Keamanan','নিরাপত্তা','سیکیورٹی','Güvenlik','Bảo mật','Sicurezza','보안','பாதுகாப்பு'),
    'Billing':         E('Facturación','账单','बिलिंग','الفوترة','Faturamento','Facturation','Abrechnung','請求','Оплата','Penagihan','বিলিং','بلنگ','Faturalandırma','Thanh toán','Fatturazione','결제','பில்லிங்'),
    'Usage':           E('Uso','用量','उपयोग','الاستخدام','Uso','Utilisation','Nutzung','使用状況','Использование','Penggunaan','ব্যবহার','استعمال','Kullanım','Sử dụng','Utilizzo','사용량','பயன்பாடு'),
    'Capabilities':    E('Capacidades','功能','क्षमताएँ','القدرات','Recursos','Capacités','Funktionen','機能','Возможности','Kemampuan','সক্ষমতা','صلاحیتیں','Yetenekler','Khả năng','Funzionalità','기능','திறன்கள்'),
    'Appearance':      E('Apariencia','外观','दिखावट','المظهر','Aparência','Apparence','Erscheinungsbild','外観','Внешний вид','Tampilan','চেহারা','ظاہری شکل','Görünüm','Giao diện','Aspetto','모양','தோற்றம்'),
    'Language':        E('Idioma','语言','भाषा','اللغة','Idioma','Langue','Sprache','言語','Язык','Bahasa','ভাষা','زبان','Dil','Ngôn ngữ','Lingua','언어','மொழி'),
    'Skills':          E('Habilidades','技能','कौशल','المهارات','Habilidades','Compétences','Fähigkeiten','スキル','Навыки','Keterampilan','দক্ষতা','مہارتیں','Beceriler','Kỹ năng','Competenze','스킬','திறன்கள்'),
    'Connectors':      E('Conectores','连接器','कनेक्टर','الموصلات','Conectores','Connecteurs','Konnektoren','コネクタ','Коннекторы','Konektor','কানেক্টর','کنیکٹرز','Bağlayıcılar','Trình kết nối','Connettori','커넥터','இணைப்பிகள்'),
    'Integrations':    E('Integraciones','集成','एकीकरण','التكاملات','Integrações','Intégrations','Integrationen','連携','Интеграции','Integrasi','ইন্টিগ্রেশন','انضمام','Entegrasyonlar','Tích hợp','Integrazioni','통합','ஒருங்கிணைப்புகள்'),
    'About':           E('Acerca de','关于','के बारे में','حول','Sobre','À propos','Über','概要','О программе','Tentang','সম্পর্কে','بارے میں','Hakkında','Giới thiệu','Informazioni','정보','பற்றி'),
    'Preferences':     E('Preferencias','偏好','प्राथमिकताएँ','التفضيلات','Preferências','Préférences','Einstellungen','設定','Настройки','Preferensi','পছন্দসমূহ','ترجیحات','Tercihler','Tùy chọn','Preferenze','환경설정','விருப்பங்கள்'),
    'Full name':       E('Nombre completo','全名','पूरा नाम','الاسم الكامل','Nome completo','Nom complet','Vollständiger Name','氏名','Полное имя','Nama lengkap','পুরো নাম','پورا نام','Ad soyad','Họ và tên','Nome completo','전체 이름','முழு பெயர்'),
    'Nickname':        E('Apodo','昵称','उपनाम','الكنية','Apelido','Surnom','Spitzname','ニックネーム','Псевдоним','Nama panggilan','ডাকনাম','عرفیت','Takma ad','Biệt danh','Soprannome','닉네임','புனைப்பெயர்'),
    'Password':        E('Contraseña','密码','पासवर्ड','كلمة المرور','Senha','Mot de passe','Passwort','パスワード','Пароль','Kata sandi','পাসওয়ার্ড','پاس ورڈ','Şifre','Mật khẩu','Password','비밀번호','கடவுச்சொல்'),
    'Sign out':        E('Cerrar sesión','退出','साइन आउट','تسجيل الخروج','Sair','Se déconnecter','Abmelden','サインアウト','Выйти','Keluar','সাইন আউট','سائن آؤٹ','Çıkış yap','Đăng xuất','Esci','로그아웃','வெளியேறு'),
    'Sign Out':        E('Cerrar sesión','退出','साइन आउट','تسجيل الخروج','Sair','Se déconnecter','Abmelden','サインアウト','Выйти','Keluar','সাইন আউট','سائن آؤٹ','Çıkış yap','Đăng xuất','Esci','로그아웃','வெளியேறு'),
    'Switch Account':  E('Cambiar cuenta','切换账户','खाता बदलें','تبديل الحساب','Trocar conta','Changer de compte','Konto wechseln','アカウント切替','Сменить аккаунт','Ganti akun','অ্যাকাউন্ট পরিবর্তন','اکاؤنٹ بدلیں','Hesap değiştir','Đổi tài khoản','Cambia account','계정 전환','கணக்கை மாற்று'),
    'Export data':     E('Exportar datos','导出数据','डेटा निर्यात करें','تصدير البيانات','Exportar dados','Exporter les données','Daten exportieren','データをエクスポート','Экспорт данных','Ekspor data','ডেটা রপ্তানি','ڈیٹا برآمد کریں','Verileri dışa aktar','Xuất dữ liệu','Esporta dati','데이터 내보내기','தரவை ஏற்றுமதி செய்'),
    'Delete everything':E('Eliminar todo','删除全部','सब कुछ हटाएँ','حذف كل شيء','Excluir tudo','Tout supprimer','Alles löschen','すべて削除','Удалить всё','Hapus semua','সবকিছু মুছুন','سب کچھ حذف کریں','Her şeyi sil','Xóa mọi thứ','Elimina tutto','모두 삭제','அனைத்தையும் நீக்கு'),

    // ---- Appearance options ----
    'Theme':           E('Tema','主题','थीम','السمة','Tema','Thème','Design','テーマ','Тема','Tema','থিম','تھیم','Tema','Chủ đề','Tema','테마','தீம்'),
    'Dark':            E('Oscuro','深色','गहरा','داكن','Escuro','Sombre','Dunkel','ダーク','Тёмная','Gelap','ডার্ক','گہرا','Koyu','Tối','Scuro','다크','இருள்'),
    'Dark Mode':       E('Modo oscuro','深色模式','डार्क मोड','الوضع الداكن','Modo escuro','Mode sombre','Dunkelmodus','ダークモード','Тёмный режим','Mode gelap','ডার্ক মোড','ڈارک موڈ','Koyu mod','Chế độ tối','Modalità scura','다크 모드','இருள் பயன்முறை'),
    'Font size':       E('Tamaño de fuente','字体大小','फ़ॉन्ट आकार','حجم الخط','Tamanho da fonte','Taille de police','Schriftgröße','文字サイズ','Размер шрифта','Ukuran font','ফন্ট আকার','فونٹ سائز','Yazı tipi boyutu','Cỡ chữ','Dimensione carattere','글꼴 크기','எழுத்துரு அளவு'),
    'Accent color':    E('Color de acento','强调色','एक्सेंट रंग','لون التمييز','Cor de destaque','Couleur d’accent','Akzentfarbe','アクセント色','Акцентный цвет','Warna aksen','অ্যাকসেন্ট রঙ','ایکسنٹ رنگ','Vurgu rengi','Màu nhấn','Colore accento','강조 색상','முனைப்பு நிறம்'),
    'Small':           E('Pequeño','小','छोटा','صغير','Pequeno','Petit','Klein','小','Маленький','Kecil','ছোট','چھوٹا','Küçük','Nhỏ','Piccolo','작게','சிறியது'),
    'Normal':          E('Normal','正常','सामान्य','عادي','Normal','Normal','Normal','標準','Обычный','Normal','স্বাভাবিক','عام','Normal','Bình thường','Normale','보통','இயல்பு'),
    'Large':           E('Grande','大','बड़ा','كبير','Grande','Grand','Groß','大','Большой','Besar','বড়','بڑا','Büyük','Lớn','Grande','크게','பெரியது'),
    'Language':        E('Idioma','语言','भाषा','اللغة','Idioma','Langue','Sprache','言語','Язык','Bahasa','ভাষা','زبان','Dil','Ngôn ngữ','Lingua','언어','மொழி'),

    // ---- Plans ----
    'Free':            E('Gratis','免费','मुफ़्त','مجاني','Grátis','Gratuit','Kostenlos','無料','Бесплатно','Gratis','ফ্রি','مفت','Ücretsiz','Miễn phí','Gratis','무료','இலவசம்'),
    'Pro':             E('Pro','专业版','प्रो','برو','Pro','Pro','Pro','プロ','Про','Pro','প্রো','پرو','Pro','Pro','Pro','프로','புரோ'),
    'Elite':           E('Élite','精英版','एलीट','النخبة','Elite','Élite','Elite','エリート','Элит','Elite','এলিট','ایلیٹ','Elit','Ưu tú','Elite','엘리트','எலைட்'),
    'Ultra':           E('Ultra','旗舰版','अल्ट्रा','ألترا','Ultra','Ultra','Ultra','ウルトラ','Ультра','Ultra','আল্ট্রা','الٹرا','Ultra','Ultra','Ultra','울트라','அல்ட்ரா'),
    'Custom':          E('Personalizado','定制','कस्टम','مخصص','Personalizado','Personnalisé','Individuell','カスタム','Свой','Kustom','কাস্টম','حسب ضرورت','Özel','Tùy chỉnh','Personalizzato','맞춤','தனிப்பயன்'),
    'Most Popular':    E('Más popular','最受欢迎','सबसे लोकप्रिय','الأكثر شيوعاً','Mais popular','Le plus populaire','Am beliebtesten','人気No.1','Популярный','Terpopuler','সবচেয়ে জনপ্রিয়','سب سے مقبول','En popüler','Phổ biến nhất','Più popolare','가장 인기','மிகவும் பிரபலம்'),
    'Most popular':    E('Más popular','最受欢迎','सबसे लोकप्रिय','الأكثر شيوعاً','Mais popular','Le plus populaire','Am beliebtesten','人気No.1','Популярный','Terpopuler','সবচেয়ে জনপ্রিয়','سب سے مقبول','En popüler','Phổ biến nhất','Più popolare','가장 인기','மிகவும் பிரபலம்'),
    'Best Value':      E('Mejor valor','超值之选','सर्वोत्तम मूल्य','أفضل قيمة','Melhor valor','Meilleur rapport','Bestes Angebot','お買い得','Выгодно','Nilai terbaik','সেরা মূল্য','بہترین قیمت','En iyi değer','Giá trị nhất','Miglior valore','최고 가치','சிறந்த மதிப்பு'),
    'Current plan':    E('Plan actual','当前套餐','वर्तमान योजना','الخطة الحالية','Plano atual','Forfait actuel','Aktueller Tarif','現在のプラン','Текущий тариф','Paket saat ini','বর্তমান প্ল্যান','موجودہ منصوبہ','Mevcut plan','Gói hiện tại','Piano attuale','현재 요금제','தற்போதைய திட்டம்'),
    'Subscription':    E('Suscripción','订阅','सदस्यता','الاشتراك','Assinatura','Abonnement','Abonnement','サブスク','Подписка','Langganan','সাবস্ক্রিপশন','سبسکرپشن','Abonelik','Đăng ký','Abbonamento','구독','சந்தா'),

    // ---- Status / misc ----
    'Current usage':   E('Uso actual','当前用量','वर्तमान उपयोग','الاستخدام الحالي','Uso atual','Utilisation actuelle','Aktuelle Nutzung','現在の使用量','Текущее использование','Penggunaan saat ini','বর্তমান ব্যবহার','موجودہ استعمال','Mevcut kullanım','Sử dụng hiện tại','Utilizzo attuale','현재 사용량','தற்போதைய பயன்பாடு'),
    'System status':   E('Estado del sistema','系统状态','सिस्टम स्थिति','حالة النظام','Status do sistema','État du système','Systemstatus','システム状態','Статус системы','Status sistem','সিস্টেম স্ট্যাটাস','سسٹم اسٹیٹس','Sistem durumu','Trạng thái hệ thống','Stato del sistema','시스템 상태','கணினி நிலை'),
    'Keyboard shortcuts':E('Atajos de teclado','键盘快捷键','कीबोर्ड शॉर्टकट','اختصارات لوحة المفاتيح','Atalhos de teclado','Raccourcis clavier','Tastenkürzel','キーボードショートカット','Горячие клавиши','Pintasan keyboard','কীবোর্ড শর্টকাট','کی بورڈ شارٹ کٹس','Klavye kısayolları','Phím tắt','Scorciatoie da tastiera','키보드 단축키','விசைப்பலகை குறுக்குவழிகள்'),
    'Keyboard Shortcuts':E('Atajos de teclado','键盘快捷键','कीबोर्ड शॉर्टकट','اختصارات لوحة المفاتيح','Atalhos de teclado','Raccourcis clavier','Tastenkürzel','キーボードショートカット','Горячие клавиши','Pintasan keyboard','কীবোর্ড শর্টকাট','کی بورڈ شارٹ کٹس','Klavye kısayolları','Phím tắt','Scorciatoie da tastiera','키보드 단축키','விசைப்பலகை குறுக்குவழிகள்'),
    'New line':        E('Nueva línea','换行','नई पंक्ति','سطر جديد','Nova linha','Nouvelle ligne','Neue Zeile','改行','Новая строка','Baris baru','নতুন লাইন','نئی لائن','Yeni satır','Dòng mới','Nuova riga','새 줄','புதிய வரி'),
    'Toggle sidebar':  E('Alternar barra lateral','切换侧栏','साइडबार टॉगल करें','تبديل الشريط الجانبي','Alternar barra lateral','Basculer la barre','Seitenleiste umschalten','サイドバー切替','Боковая панель','Alihkan bilah sisi','সাইডবার টগল','سائیڈبار ٹوگل','Kenar çubuğunu aç/kapat','Bật/tắt thanh bên','Mostra/nascondi barra','사이드바 전환','பக்கப்பட்டியை மாற்று'),
    "What's New":      E('Novedades','新功能','नया क्या है','ما الجديد','Novidades','Nouveautés','Neuigkeiten','新着情報','Что нового','Yang baru','নতুন কী','نیا کیا ہے','Yenilikler','Có gì mới','Novità','새로운 기능','புதியது என்ன'),
    'Page not found':  E('Página no encontrada','页面未找到','पृष्ठ नहीं मिला','الصفحة غير موجودة','Página não encontrada','Page introuvable','Seite nicht gefunden','ページが見つかりません','Страница не найдена','Halaman tidak ditemukan','পৃষ্ঠা পাওয়া যায়নি','صفحہ نہیں ملا','Sayfa bulunamadı','Không tìm thấy trang','Pagina non trovata','페이지를 찾을 수 없음','பக்கம் கிடைக்கவில்லை'),
    'Help Center':     E('Centro de ayuda','帮助中心','सहायता केंद्र','مركز المساعدة','Central de ajuda','Centre d’aide','Hilfecenter','ヘルプセンター','Центр помощи','Pusat bantuan','সহায়তা কেন্দ্র','مدد مرکز','Yardım merkezi','Trung tâm trợ giúp','Centro assistenza','도움말 센터','உதவி மையம்'),
    'Contact Support': E('Contactar soporte','联系支持','सहायता से संपर्क करें','اتصل بالدعم','Contatar suporte','Contacter le support','Support kontaktieren','サポートに連絡','Связаться с поддержкой','Hubungi dukungan','সহায়তায় যোগাযোগ','سپورٹ سے رابطہ','Desteğe başvur','Liên hệ hỗ trợ','Contatta assistenza','지원팀 문의','ஆதரவைத் தொடர்பு கொள்ளுங்கள்'),
    'Terms of Service':E('Términos de servicio','服务条款','सेवा की शर्तें','شروط الخدمة','Termos de serviço','Conditions d’utilisation','Nutzungsbedingungen','利用規約','Условия использования','Ketentuan layanan','পরিষেবার শর্তাবলী','سروس کی شرائط','Hizmet şartları','Điều khoản dịch vụ','Termini di servizio','서비스 약관','சேவை விதிமுறைகள்'),
    'Privacy Policy':  E('Política de privacidad','隐私政策','गोपनीयता नीति','سياسة الخصوصية','Política de privacidade','Politique de confidentialité','Datenschutzrichtlinie','プライバシーポリシー','Политика конфиденциальности','Kebijakan privasi','গোপনীয়তা নীতি','رازداری کی پالیسی','Gizlilik politikası','Chính sách bảo mật','Informativa privacy','개인정보 처리방침','தனியுரிமைக் கொள்கை'),
    'Research':        E('Investigar','研究','अनुसंधान','بحث','Pesquisa','Recherche','Recherche','リサーチ','Исследование','Riset','গবেষণা','تحقیق','Araştırma','Nghiên cứu','Ricerca','리서치','ஆராய்ச்சி'),
    'Code':            E('Código','代码','कोड','الكود','Código','Code','Code','コード','Код','Kode','কোড','کوڈ','Kod','Mã','Codice','코드','குறியீடு'),
    'Files':           E('Archivos','文件','फ़ाइलें','الملفات','Arquivos','Fichiers','Dateien','ファイル','Файлы','File','ফাইল','فائلیں','Dosyalar','Tệp','File','파일','கோப்புகள்'),
    'Style':           E('Estilo','风格','शैली','النمط','Estilo','Style','Stil','スタイル','Стиль','Gaya','স্টাইল','انداز','Stil','Phong cách','Stile','스타일','பாணி'),
    'Duration':        E('Duración','时长','अवधि','المدة','Duração','Durée','Dauer','長さ','Длительность','Durasi','সময়কাল','دورانیہ','Süre','Thời lượng','Durata','길이','கால அளவு'),
    'Output':          E('Salida','输出','आउटपुट','الناتج','Saída','Sortie','Ausgabe','出力','Результат','Keluaran','আউটপুট','آؤٹ پٹ','Çıktı','Đầu ra','Output','출력','வெளியீடு'),
    'Preview':         E('Vista previa','预览','पूर्वावलोकन','معاينة','Prévia','Aperçu','Vorschau','プレビュー','Просмотр','Pratinjau','প্রিভিউ','پیش نظارہ','Önizleme','Xem trước','Anteprima','미리보기','முன்னோட்டம்'),
    'Earnings':        E('Ganancias','收入','कमाई','الأرباح','Ganhos','Revenus','Einnahmen','収益','Доход','Penghasilan','আয়','کمائی','Kazançlar','Thu nhập','Guadagni','수익','வருவாய்'),
    'Finance':         E('Finanzas','财务','वित्त','المالية','Finanças','Finances','Finanzen','財務','Финансы','Keuangan','অর্থ','مالیات','Finans','Tài chính','Finanza','재무','நிதி'),
    'Dashboard':       E('Panel','仪表板','डैशबोर्ड','لوحة القيادة','Painel','Tableau de bord','Übersicht','ダッシュボード','Панель','Dasbor','ড্যাশবোর্ড','ڈیش بورڈ','Kontrol paneli','Bảng điều khiển','Dashboard','대시보드','டாஷ்போர்டு'),
    'Messages':        E('Mensajes','消息','संदेश','الرسائل','Mensagens','Messages','Nachrichten','メッセージ','Сообщения','Pesan','বার্তা','پیغامات','Mesajlar','Tin nhắn','Messaggi','메시지','செய்திகள்'),
    'Sessions':        E('Sesiones','会话','सत्र','الجلسات','Sessões','Sessions','Sitzungen','セッション','Сессии','Sesi','সেশন','سیشنز','Oturumlar','Phiên','Sessioni','세션','அமர்வுகள்'),
    'Active':          E('Activo','活跃','सक्रिय','نشط','Ativo','Actif','Aktiv','アクティブ','Активно','Aktif','সক্রিয়','فعال','Aktif','Đang hoạt động','Attivo','활성','செயலில்'),
    'Incoming':        E('Entrante','传入','आवक','وارد','Recebido','Entrant','Eingehend','受信','Входящие','Masuk','আগত','آنے والا','Gelen','Đến','In arrivo','수신','உள்வரும்'),
    'Sent':            E('Enviado','已发送','भेजा गया','مرسل','Enviado','Envoyé','Gesendet','送信済み','Отправлено','Terkirim','পাঠানো হয়েছে','بھیجا گیا','Gönderildi','Đã gửi','Inviato','전송됨','அனுப்பப்பட்டது'),
    'Newest':          E('Más reciente','最新','नवीनतम','الأحدث','Mais recente','Le plus récent','Neueste','最新','Новейшие','Terbaru','নতুনতম','تازہ ترین','En yeni','Mới nhất','Più recente','최신','புதியது'),
    'Best rated':      E('Mejor valorado','评分最高','सर्वोत्तम रेटेड','الأعلى تقييماً','Melhor avaliado','Les mieux notés','Bestbewertet','高評価','Лучшие','Rating tertinggi','সেরা রেটেড','بہترین درجہ','En yüksek puanlı','Đánh giá cao nhất','Più votati','평점 높은순','சிறந்த மதிப்பீடு'),
    'Top sellers':     E('Más vendidos','热销','शीर्ष विक्रेता','الأكثر مبيعاً','Mais vendidos','Meilleures ventes','Bestseller','売れ筋','Хиты продаж','Terlaris','সেরা বিক্রেতা','ٹاپ سیلرز','En çok satanlar','Bán chạy nhất','Più venduti','베스트셀러','அதிக விற்பனை'),
    'My purchases':    E('Mis compras','我的购买','मेरी खरीदारी','مشترياتي','Minhas compras','Mes achats','Meine Käufe','購入履歴','Мои покупки','Pembelian saya','আমার কেনাকাটা','میری خریداری','Satın aldıklarım','Đơn mua của tôi','I miei acquisti','내 구매','எனது கொள்முதல்கள்'),
    'General':         E('General','通用','सामान्य','عام','Geral','Général','Allgemein','一般','Общие','Umum','সাধারণ','عام','Genel','Chung','Generale','일반','பொது'),
    'Personal':        E('Personal','个人','व्यक्तिगत','شخصي','Pessoal','Personnel','Persönlich','個人','Личное','Pribadi','ব্যক্তিগত','ذاتی','Kişisel','Cá nhân','Personale','개인','தனிப்பட்ட'),
    'Business':        E('Empresa','商业','व्यवसाय','الأعمال','Negócios','Entreprise','Unternehmen','ビジネス','Бизнес','Bisnis','ব্যবসা','کاروبار','İşletme','Doanh nghiệp','Azienda','비즈니스','வணிகம்'),
    'Marketing':       E('Marketing','营销','मार्केटिंग','التسويق','Marketing','Marketing','Marketing','マーケティング','Маркетинг','Pemasaran','মার্কেটিং','مارکیٹنگ','Pazarlama','Tiếp thị','Marketing','마케팅','சந்தைப்படுத்தல்'),
    'Sales':           E('Ventas','销售','बिक्री','المبيعات','Vendas','Ventes','Vertrieb','営業','Продажи','Penjualan','বিক্রয়','فروخت','Satış','Bán hàng','Vendite','영업','விற்பனை'),
    'Education':       E('Educación','教育','शिक्षा','التعليم','Educação','Éducation','Bildung','教育','Образование','Pendidikan','শিক্ষা','تعلیم','Eğitim','Giáo dục','Istruzione','교육','கல்வி'),
    'Productivity':    E('Productividad','生产力','उत्पादकता','الإنتاجية','Produtividade','Productivité','Produktivität','生産性','Продуктивность','Produktivitas','উৎপাদনশীলতা','پیداواری صلاحیت','Üretkenlik','Năng suất','Produttività','생산성','உற்பத்தித்திறன்'),
    'Developer':       E('Desarrollador','开发者','डेवलपर','المطور','Desenvolvedor','Développeur','Entwickler','開発者','Разработчик','Pengembang','ডেভেলপার','ڈیولپر','Geliştirici','Nhà phát triển','Sviluppatore','개발자','டெவலப்பர்'),
    'Student':         E('Estudiante','学生','छात्र','طالب','Estudante','Étudiant','Student','学生','Студент','Pelajar','ছাত্র','طالب علم','Öğrenci','Sinh viên','Studente','학생','மாணவர்'),
    'Work':            E('Trabajo','工作','काम','العمل','Trabalho','Travail','Arbeit','仕事','Работа','Kerja','কাজ','کام','İş','Công việc','Lavoro','업무','வேலை'),
    'Auto':            E('Auto','自动','ऑटो','تلقائي','Auto','Auto','Auto','自動','Авто','Otomatis','অটো','آٹو','Otomatik','Tự động','Auto','자동','தானி'),
    'Auto-detect':     E('Autodetectar','自动检测','स्वतः पहचान','كشف تلقائي','Detectar automaticamente','Détection auto','Automatisch erkennen','自動検出','Автоопределение','Deteksi otomatis','স্বয়ংক্রিয় সনাক্তকরণ','خودکار شناخت','Otomatik algıla','Tự động phát hiện','Rilevamento automatico','자동 감지','தானாக கண்டறி'),
    'Response language':E('Idioma de respuesta','回复语言','उत्तर भाषा','لغة الرد','Idioma da resposta','Langue de réponse','Antwortsprache','応答言語','Язык ответа','Bahasa respons','উত্তরের ভাষা','جواب کی زبان','Yanıt dili','Ngôn ngữ trả lời','Lingua di risposta','응답 언어','பதில் மொழி'),
    'Reduce animation':E('Reducir animación','减少动画','एनिमेशन कम करें','تقليل الحركة','Reduzir animação','Réduire l’animation','Animation reduzieren','アニメーション低減','Меньше анимации','Kurangi animasi','অ্যানিমেশন কমান','اینیمیشن کم کریں','Animasyonu azalt','Giảm hiệu ứng','Riduci animazioni','애니메이션 줄이기','அசைவூட்டத்தைக் குறை'),
    'Motion':          E('Movimiento','动效','मोशन','الحركة','Movimento','Mouvement','Bewegung','モーション','Движение','Gerak','মোশন','حرکت','Hareket','Chuyển động','Movimento','모션','அசைவு'),
    'Default':         E('Predeterminado','默认','डिफ़ॉल्ट','افتراضي','Padrão','Par défaut','Standard','デフォルト','По умолчанию','Default','ডিফল্ট','ڈیفالٹ','Varsayılan','Mặc định','Predefinito','기본값','இயல்புநிலை'),
    'Controls':        E('Controles','控制','नियंत्रण','التحكم','Controles','Contrôles','Steuerung','コントロール','Управление','Kontrol','নিয়ন্ত্রণ','کنٹرولز','Kontroller','Điều khiển','Controlli','컨트롤','கட்டுப்பாடுகள்'),
    'Aspect':          E('Aspecto','比例','पहलू','النسبة','Proporção','Format','Seitenverhältnis','アスペクト','Соотношение','Aspek','অনুপাত','تناسب','En boy oranı','Tỷ lệ','Proporzioni','비율','விகிதம்'),
    'Ratio':           E('Proporción','比例','अनुपात','النسبة','Proporção','Ratio','Verhältnis','比率','Соотношение','Rasio','অনুপাত','تناسب','Oran','Tỷ lệ','Rapporto','비율','விகிதம்'),
    'Mood':            E('Ambiente','氛围','मूड','المزاج','Clima','Ambiance','Stimmung','ムード','Настроение','Suasana','মেজাজ','موڈ','Ruh hali','Tâm trạng','Atmosfera','분위기','மனநிலை'),
    'Presets':         E('Preajustes','预设','प्रीसेट','الإعدادات المسبقة','Predefinições','Préréglages','Voreinstellungen','プリセット','Пресеты','Preset','প্রিসেট','پیش سیٹ','Ön ayarlar','Cài đặt sẵn','Preset','프리셋','முன்னமைவுகள்'),
    'Your data':       E('Tus datos','你的数据','आपका डेटा','بياناتك','Seus dados','Vos données','Ihre Daten','あなたのデータ','Ваши данные','Data Anda','আপনার ডেটা','آپ کا ڈیٹا','Verileriniz','Dữ liệu của bạn','I tuoi dati','내 데이터','உங்கள் தரவு'),
    'Your name':       E('Tu nombre','你的名字','आपका नाम','اسمك','Seu nome','Votre nom','Ihr Name','あなたの名前','Ваше имя','Nama Anda','আপনার নাম','آپ کا نام','Adınız','Tên của bạn','Il tuo nome','이름','உங்கள் பெயர்'),
    'Your impact':     E('Tu impacto','你的成果','आपका प्रभाव','تأثيرك','Seu impacto','Votre impact','Ihre Wirkung','あなたの成果','Ваш вклад','Dampak Anda','আপনার প্রভাব','آپ کا اثر','Etkiniz','Tác động của bạn','Il tuo impatto','내 영향','உங்கள் தாக்கம்'),
    'Your skills':     E('Tus habilidades','你的技能','आपके कौशल','مهاراتك','Suas habilidades','Vos compétences','Ihre Fähigkeiten','あなたのスキル','Ваши навыки','Keterampilan Anda','আপনার দক্ষতা','آپ کی مہارتیں','Becerileriniz','Kỹ năng của bạn','Le tue competenze','내 스킬','உங்கள் திறன்கள்'),
    'Your messages':   E('Tus mensajes','你的消息','आपके संदेश','رسائلك','Suas mensagens','Vos messages','Ihre Nachrichten','あなたのメッセージ','Ваши сообщения','Pesan Anda','আপনার বার্তা','آپ کے پیغامات','Mesajlarınız','Tin nhắn của bạn','I tuoi messaggi','내 메시지','உங்கள் செய்திகள்'),
    'Recurring work':  E('Trabajo recurrente','周期性工作','आवर्ती कार्य','عمل متكرر','Trabalho recorrente','Travail récurrent','Wiederkehrende Arbeit','定期作業','Повторяющаяся работа','Kerja berulang','পুনরাবৃত্ত কাজ','بار بار کام','Yinelenen iş','Công việc định kỳ','Lavoro ricorrente','반복 작업','தொடர் வேலை'),
    'Scheduled work':  E('Trabajo programado','计划工作','निर्धारित कार्य','عمل مجدول','Trabalho agendado','Travail planifié','Geplante Arbeit','予約作業','Запланированная работа','Kerja terjadwal','নির্ধারিত কাজ','شیڈول شدہ کام','Zamanlanmış iş','Công việc đã lên lịch','Lavoro pianificato','예약 작업','திட்டமிட்ட வேலை'),
    'Add Memory':      E('Añadir memoria','添加记忆','स्मृति जोड़ें','إضافة ذاكرة','Adicionar memória','Ajouter une mémoire','Speicher hinzufügen','メモリを追加','Добавить память','Tambah memori','স্মৃতি যোগ করুন','یادداشت شامل کریں','Bellek ekle','Thêm bộ nhớ','Aggiungi memoria','메모리 추가','நினைவகம் சேர்'),
    'Open memory':     E('Abrir memoria','打开记忆','स्मृति खोलें','فتح الذاكرة','Abrir memória','Ouvrir la mémoire','Speicher öffnen','メモリを開く','Открыть память','Buka memori','স্মৃতি খুলুন','یادداشت کھولیں','Belleği aç','Mở bộ nhớ','Apri memoria','메모리 열기','நினைவகத்தைத் திற'),
    'Clear chats':     E('Borrar chats','清除对话','चैट साफ़ करें','مسح المحادثات','Limpar conversas','Effacer les chats','Chats löschen','チャットを消去','Очистить чаты','Hapus obrolan','চ্যাট সাফ করুন','چیٹس صاف کریں','Sohbetleri temizle','Xóa trò chuyện','Cancella chat','채팅 지우기','அரட்டைகளை அழி'),
    'Remove photo':    E('Quitar foto','移除照片','फ़ोटो हटाएँ','إزالة الصورة','Remover foto','Supprimer la photo','Foto entfernen','写真を削除','Удалить фото','Hapus foto','ছবি সরান','تصویر ہٹائیں','Fotoğrafı kaldır','Xóa ảnh','Rimuovi foto','사진 제거','புகைப்படத்தை அகற்று'),
    'Try it →':        E('Pruébalo →','试试 →','आज़माएँ →','جرّبه →','Experimente →','Essayez →','Ausprobieren →','試す →','Попробовать →','Coba →','চেষ্টা করুন →','آزمائیں →','Deneyin →','Thử ngay →','Provalo →','사용해보기 →','முயற்சி →'),
    'Get started free':E('Comienza gratis','免费开始','मुफ़्त शुरू करें','ابدأ مجاناً','Comece grátis','Commencer gratuitement','Kostenlos starten','無料で始める','Начать бесплатно','Mulai gratis','ফ্রি শুরু করুন','مفت شروع کریں','Ücretsiz başla','Bắt đầu miễn phí','Inizia gratis','무료로 시작','இலவசமாகத் தொடங்கு'),
  };

  try{
    if(typeof window!=='undefined'){
      window.__AMV_I18N_DICT__ = D;
    }
  }catch(e){}
  if(typeof module!=='undefined' && module.exports){ module.exports = D; }
})();
try{ if(typeof window!=='undefined' && window.__AMV_I18N_DICT__){ for(const k in window.__AMV_I18N_DICT__){ if(!Object.prototype.hasOwnProperty.call(I18N,k)) I18N[k]=window.__AMV_I18N_DICT__[k]; } } }catch(e){}
function T(s){ const code=_lang(); if(code==='auto'||code==='en') return s; let e=I18N[s]; if(e&&e[code]) return e[code];
  // case-insensitive fallback so 'Sign Out' matches 'Sign out', 'New Chat' matches 'New chat', etc.
  if(!e){ const lo=String(s).toLowerCase(); for(const k in I18N){ if(k.toLowerCase()===lo){ e=I18N[k]; break; } } }
  return (e&&e[code])||s; }
function _applyDir(){ try{ const code=_lang(); document.documentElement.dir=(RTL_LANGS.indexOf(code)>=0?'rtl':'ltr'); document.documentElement.lang=(code==='auto'?'en':code); }catch(e){} }
/* Translate the static UI chrome. Stores each element's English source once,
   then re-applies T() on every language change so switching is reversible. */
/* ============================================================
   WHOLE-UI TRANSLATION.
   - Walks the entire visible DOM (every text node + key attributes).
   - Instant terms come from the I18N dictionary.
   - Anything else is translated by AMV itself and cached in
     localStorage, so the whole site ends up in the chosen
     language without a hand-written entry for every string.
   ============================================================ */
let _i18nBusy=false, _i18nApplying=false, _i18nObserver=null, _i18nRaf=0;
/* Every surface the UI translator must cover. Popups and the top-right profile
   menu are appended to document.body (OUTSIDE #app), and modals render into
   #ovr - so translating only #app left all of them stuck in English. */
function _i18nRoots(){
  const out=[];
  ['app','ovr'].forEach(id=>{ const el=document.getElementById(id); if(el) out.push(el); });
  document.querySelectorAll('.prof-menu,.ctxm').forEach(el=>{ if(out.indexOf(el)<0) out.push(el); });
  return out;
}
function _i18nCache(){ try{ return load('amv_i18n_cache')||{}; }catch(e){ return {}; } }
function _i18nSaveCache(c){ try{ store('amv_i18n_cache',c); }catch(e){} }
function _i18nKey(code,s){ return code+'\u0001'+s; }
// collect every visible text node + translatable attribute under root
function _collectI18nNodes(root){
  const out=[]; const SKIP={SCRIPT:1,STYLE:1,SVG:1,CODE:1,PRE:1,TEXTAREA:1};
  const walk=(el)=>{
    if(!el) return;
    for(const node of el.childNodes){
      if(node.nodeType===3){ const t=node.nodeValue; if(t && t.trim().length>1 && (/[A-Za-z]/.test(t) || node._i18nSrc!=null)) out.push({type:'text',node}); }
      else if(node.nodeType===1){
        const tag=node.tagName;
        if(SKIP[tag]) continue;
        if(node.closest && node.closest('[data-no-i18n]')) continue;
        const ph=node.getAttribute&&node.getAttribute('placeholder'); if(ph&&ph.trim()&&(/[A-Za-z]/.test(ph)||node._i18nPhSrc!=null)) out.push({type:'ph',node});
        walk(node);
      }
    }
  };
  walk(root);
  return out;
}
function _translateUI(){
  _i18nApplying=true;   // suppress the observer while we mutate, so we never self-loop
  try{
    _applyDir();
    const code=_lang();
    // sidebar/nav fast path via dictionary (always instant, always from original)
    document.querySelectorAll('.snb[data-tab]').forEach(b=>{
      if(!b.dataset.i18nSrc){ b.dataset.i18nSrc=(b.textContent||'').trim(); }
      [...b.childNodes].forEach(n=>{ if(n.nodeType===3) n.remove(); });
      b.appendChild(document.createTextNode(T(b.dataset.i18nSrc)));
    });
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      if(!el.dataset.i18nSrc){ el.dataset.i18nSrc=(el.textContent||'').trim(); }
      el.textContent=T(el.dataset.i18nSrc);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
      if(!el.dataset.i18nPhSrc){ el.dataset.i18nPhSrc=el.getAttribute('placeholder')||''; }
      el.setAttribute('placeholder', T(el.dataset.i18nPhSrc));
    });
    // whole-DOM pass. When switching to English/auto, RESTORE originals so nothing
    // gets stuck in a previous language. Otherwise translate.
    if(code==='auto'||code==='en'){ _i18nRoots().forEach(r=>_restoreI18nDOM(r)); return; }
    _i18nRoots().forEach(r=>_autoTranslateDOM(code, r));
  }catch(e){ console.warn('_translateUI failed:', e); }
  finally{ try{ requestAnimationFrame(()=>{ _i18nApplying=false; }); }catch(e){ _i18nApplying=false; } }
}
/* Auto-translate anything rendered AFTER a language is chosen - the profile
   menu (top-right), popups, modals in #ovr, a freshly switched tab - so the
   WHOLE interface follows the language, not just what existed at switch time.
   Live chat content (#cm / [data-no-i18n]) is deliberately skipped: the AI
   already replies in the chosen language, and re-translating a stream is wrong. */
function _initI18nObserver(){
  if(_i18nObserver || typeof MutationObserver==='undefined') return;
  const body=document.body; if(!body) return;
  _i18nObserver=new MutationObserver((muts)=>{
    if(_i18nApplying) return;
    const code=_lang(); if(code==='auto'||code==='en') return;
    let relevant=false;
    for(const m of muts){
      for(const n of m.addedNodes){
        if(n.nodeType!==1) continue;
        if(n.closest && n.closest('[data-no-i18n]')) continue;
        relevant=true; break;
      }
      if(relevant) break;
    }
    if(!relevant || _i18nRaf) return;
    _i18nRaf=requestAnimationFrame(()=>{ _i18nRaf=0; try{ _translateUI(); }catch(e){} });
  });
  _i18nObserver.observe(body,{childList:true, subtree:true});
}
try{ window._initI18nObserver=_initI18nObserver; }catch(e){}
/* Restore every translated node back to its stored original English text. */
function _restoreI18nDOM(root){
  const base=root||document.getElementById('app'); if(!base) return;
  const nodes=_collectI18nNodes(base);
  for(const it of nodes){
    try{
      if(it.type==='text'){ if(it.node._i18nSrc!=null) it.node.nodeValue=it.node._i18nSrc; }
      else { if(it.node._i18nPhSrc!=null) it.node.setAttribute('placeholder', it.node._i18nPhSrc); }
    }catch(e){}
  }
}
async function _autoTranslateDOM(code, root){
  const base=root||document.getElementById('app'); if(!base) return;
  const nodes=_collectI18nNodes(base);
  const cache=_i18nCache();
  const need=new Set();
  // apply cached/dict immediately; collect unknowns
  for(const it of nodes){
    const src=(it.type==='text'?it.node.nodeValue:it.node.getAttribute('placeholder'))||'';
    const key=src.trim(); if(!key) continue;
    // permanently remember the ORIGINAL english text so we can always restore it
    if(it.type==='text'){ if(it.node._i18nSrc==null) it.node._i18nSrc=it.node.nodeValue; }
    else { if(it.node._i18nPhSrc==null) it.node._i18nPhSrc=it.node.getAttribute('placeholder'); }
    if(!it.node._i18nKey) it.node._i18nKey=key;
    const dict=T(key);
    if(dict!==key){ _applyI18n(it,dict); continue; }
    const cached=cache[_i18nKey(code,key)];
    if(cached){ _applyI18n(it,cached); }
    else need.add(key);
  }
  if(!need.size || _i18nBusy) return;
  // translate the unknowns with AMV (one batched call), cache, re-apply
  if(!_aiBackendReady()) return; // needs a key; dictionary still covered the common chrome
  _i18nBusy=true;
  try{
    const list=[...need].slice(0,80); // batch cap
    const sys='You are a UI localizer. Translate each numbered interface string into '+_langName(code)+'. Keep it short and natural for a button/label. Return ONLY a JSON array of translations in the same order, no keys, no commentary.';
    const prompt=list.map((s,i)=>(i+1)+'. '+s).join('\n');
    const resp=await aiComplete(prompt, sys, {noLang:true, max_tokens:2000, model:'claude-haiku-4-5-20251001'});
    let arr=null; try{ arr=JSON.parse(resp.slice(resp.indexOf('['), resp.lastIndexOf(']')+1)); }catch(e){}
    if(Array.isArray(arr)){
      const c=_i18nCache();
      list.forEach((s,i)=>{ if(arr[i]) c[_i18nKey(code,s)]=String(arr[i]); });
      _i18nSaveCache(c);
      _i18nBusy=false;
      _autoTranslateDOM(code, base); // re-apply now that cache is filled
      return;
    }
  }catch(e){}
  _i18nBusy=false;
}
function _applyI18n(it,val){
  try{
    if(it.type==='text'){
      // replace using the remembered key so re-translation from a prior language works
      const key=it.node._i18nKey||(it.node._i18nSrc||'').trim();
      const orig=it.node._i18nSrc!=null?it.node._i18nSrc:it.node.nodeValue;
      it.node.nodeValue = key ? orig.replace(key, val) : val;
    } else {
      it.node.setAttribute('placeholder', val);
    }
  }catch(e){}
}
/* The instruction appended to AI prompts so responses come back in the user's language. */
function _langInstruction(){
  const code=_lang();
  const base="\n\nLANGUAGE RULES (in priority order):\n1. If the user's message explicitly asks for a specific language (e.g. \u201crespond in French\u201d, \u201cen espa\u00f1ol\u201d, \u201cin Japanese\u201d), you MUST reply in THAT language - this overrides everything else.\n2. Otherwise, ";
  if(code==='auto') return base+"detect the language the user is writing in and reply ENTIRELY in that same language. If they switch languages mid-conversation, follow their lead.";
  return base+"reply ENTIRELY in "+_langName(code)+" ("+LANGS[code].native+"), naturally and fluently, even if this prompt is in another language. Never mix languages unless the user does.";
}
/* Detects an explicit "in <language>" request in any of the supported languages. */
function _explicitLangInPrompt(text){
  if(!text) return null;
  const t=' '+text.toLowerCase()+' ';
  const map={
    english:'English', spanish:'Spanish', 'espa\u00f1ol':'Spanish', chinese:'Chinese', mandarin:'Chinese',
    hindi:'Hindi', arabic:'Arabic', portuguese:'Portuguese', 'portugu\u00eas':'Portuguese',
    french:'French', 'fran\u00e7ais':'French', german:'German', deutsch:'German',
    japanese:'Japanese', russian:'Russian', italian:'Italian', korean:'Korean', dutch:'Dutch',
    turkish:'Turkish', polish:'Polish', swedish:'Swedish', greek:'Greek', hebrew:'Hebrew',
    thai:'Thai', vietnamese:'Vietnamese', indonesian:'Indonesian', 'chino':'Chinese','japon\u00e9s':'Japanese'
  };
  // look for "in <lang>", "en <lang>", "auf <lang>", "<lang> version", "translate to <lang>"
  for(const k in map){
    const re=new RegExp('\\b(in|en|to|into|auf|\u0628\u0627\u0644|\u0e40\u0e1b\u0e47\u0e19|make it|write it|respond in|reply in|translate (?:to|into))?\\s*'+k+'\\b','i');
    if(re.test(t)) return map[k];
  }
  return null;
}
/* For image/video/model generation: bakes the language into any text in the output. */
function _langForGeneration(promptText){
  const code=_lang();
  const explicit=_explicitLangInPrompt(promptText);
  if(explicit){ return ' (Any text, labels, captions, or signage in the output must be written in '+explicit+'.)'; }
  if(code==='auto') return '';
  return ' (Any text, labels, captions, or signage in the output must be written in '+_langName(code)+'.)';
}
const AMV_EXCELLENCE = [
"",
"=== AMV QUALITY STANDARD (non-negotiable) ===",
"Every single response - on ANY model - must meet or exceed the quality of the best frontier AI in the world. This is the floor, never the ceiling. A 'fast' or 'lightweight' model is NO excuse for a lesser answer: it must be just as correct, just as insightful, just as well-crafted - only quicker. Never produce a watered-down response.",
"- DEPTH: anticipate the follow-up questions and answer them preemptively. Cover edge cases. Never give the shallow version.",
"- PRECISION: exact numbers, named sources, correct terminology, working code, verified math. If uncertain, say precisely how uncertain.",
"- TASTE: write like a brilliant human, not a template. Vary sentence rhythm. Cut filler ('certainly', 'great question', 'in conclusion'). Open with substance.",
"- FINISH: every deliverable should be ready to use as-is - an essay ready to submit, code ready to run, a plan ready to execute. No placeholders, no 'you could add…' cop-outs: ADD it.",
"- JUDGMENT: when the user's request has a better version than what they asked for, deliver what they asked AND the better version, clearly labeled.",
"- VISUAL OUTPUT: any HTML/UI/design you produce must look like a top design agency made it - real typography hierarchy, deliberate spacing, cohesive palette, polished details (hover states, shadows used sparingly, perfect alignment). Never default-looking, never generic Bootstrap-feel. The user should be able to ship or sell it.",
"=== END QUALITY STANDARD ==="
].join("\n");

const MODEL_SYSTEMS = {
  smart: SYS + AMV_EXCELLENCE,
  core: SYS + AMV_EXCELLENCE,
  fast: SYS + "\n\nPULSE MODE: You are fast, but your answer quality is IDENTICAL to the flagship - same correctness, same insight, same polish. Speed comes from efficient phrasing, never from thinking less or caring less. A short answer must be the smartest possible short answer." + AMV_EXCELLENCE,
  research: SYS + "\n\nSCOUT MODE: World-class research analyst. Search the live web when it helps. Provide exhaustive analysis: named sources with dates, statistical data, multiple expert perspectives, counter-arguments, and a clear evidence-ranked conclusion. Structure with sections; include a chart whenever data allows." + AMV_EXCELLENCE,
  coding: SYS + "\n\nFORGE MODE: Principal-level engineer. Production-ready code only: complete error handling, sensible architecture, performance-aware, secure by default. Explain key decisions in one tight paragraph, then the code. If the user's approach has a flaw, fix it and say why. Include a quick way to run/test it." + AMV_EXCELLENCE,
  image: SYS,
};



