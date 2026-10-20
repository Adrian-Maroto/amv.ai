/* ============================================================
   DESIGN DNA - universal design-system engine
   Every visual decision (color, type, shape, motion, layout,
   psychology, effects) is configurable and drives generation.
   ============================================================ */
const DNA_DEFAULT = {
  // identity
  projectName:'', projectType:'Landing page', industry:'Technology', audience:'',
  // theme
  theme:'dark', themeFamily:'linear',
  // colors - array of {role,hex}
  colors:[
    {role:'primary',hex:'#5590ff'},
    {role:'accent',hex:'#5590ff'},
    {role:'background',hex:'#0c0d10'},
    {role:'surface',hex:'#15181d'},
    {role:'text',hex:'#e9edf2'},
    {role:'muted',hex:'#8b939e'},
  ],
  saturation:60, contrast:75, temperature:'cool',
  // personality 0-100
  personality:{ professionalism:70, luxury:40, minimalism:75, creativity:55, playfulness:25, futurism:60, trust:80, authority:65, friendliness:55, exclusivity:45, sophistication:70, boldness:55, elegance:65, energy:50 },
  // psychology 0-100
  psychology:{ trust:80, authority:65, excitement:50, exclusivity:45, warmth:50, safety:70, urgency:30, confidence:75 },
  // typography
  headingFont:'Newsreader', bodyFont:'Inter', codeFont:'JetBrains Mono',
  headingWeight:'600', fontScale:'balanced', letterSpacing:'normal', lineHeight:'comfortable',
  // layout
  structure:'landing_page', maxWidth:'1200px', whitespace:'generous', density:'balanced',
  // shapes
  borderRadius:'medium', cornerStyle:'rounded', geometricness:60,
  // borders / shadows
  borderWidth:'hairline', shadowStyle:'soft', shadowDepth:50,
  // effects
  glassmorphism:false, brutalism:false, glow:30, noise:0, grain:false,
  // backgrounds
  bgStyle:'solid',
  // buttons / cards / forms
  buttonStyle:'solid', buttonRadius:'medium', cardStyle:'soft', cardElevation:'low', formStyle:'outlined',
  // icons / images
  iconStyle:'line', imageStyle:'photographic', imageRealism:80,
  // motion
  motionLevel:'subtle', motionStyle:'smooth', easing:'ease-out',
  // navigation / hero / sections
  navigation:'topbar', hero:'centered', sections:'cards',
  // content
  tone:'professional', readingLevel:'general', emojiUsage:'minimal',
  copy:{ persuasive:60, educational:55, entertaining:30, emotional:40 },
  // ai generation
  creativity:60, originality:70, predictability:45, experimentation:50,
  // constraints
  strictColors:true, strictTypography:false, strictSpacing:false, allowExperiments:true,
};
let _DNA = _loadDNA();
function _loadDNA(){ try{ const d=load('amv_dna'); if(d&&d.colors) return Object.assign(JSON.parse(JSON.stringify(DNA_DEFAULT)), d); }catch(e){} return JSON.parse(JSON.stringify(DNA_DEFAULT)); }
function _saveDNA(){ try{ store('amv_dna', _DNA); }catch(e){} }

/* The editor itself - palettes, sliders, every section - lives in
   dna-editor.js, fetched the first time somebody opens it. The page keeps only
   what every design request reads: the saved DNA and the block below. */
let _dnaEdP = null;
async function openDNA(){
  if(typeof window._openDNANow !== 'function'){
    if(!_dnaEdP) _dnaEdP = new Promise(res => {
      const sc = document.createElement('script');
      sc.src = 'dna-editor.js';
      const fail = () => { _dnaEdP = null; sc.remove(); res(false); };
      sc.onload = () => typeof window._openDNANow === 'function' ? res(true) : fail();
      sc.onerror = fail;
      document.head.appendChild(sc);
    });
    if(!(await _dnaEdP)){ toast(T('That could not be loaded. Check your connection and try again.'), 'error', 5000); return; }
  }
  return window._openDNANow();
}

/* ---- Serialize DNA into a generation directive ---- */
function dnaPromptBlock(){
  const d=_DNA;
  const cols=d.colors.map(c=>c.role+': '+c.hex).join(', ');
  const persona=Object.entries(d.personality).filter(([k,v])=>v>=65||v<=25).map(([k,v])=>k+' '+v).join(', ');
  const psych=Object.entries(d.psychology).filter(([k,v])=>v>=65).map(([k])=>k).join(', ');
  const fx=[d.glassmorphism&&'glassmorphism',d.brutalism&&'brutalism',d.grain&&'film grain'].filter(Boolean).join(', ')||'none';
  const lock=[d.strictColors&&'use ONLY the exact colors above',d.strictTypography&&'use ONLY the specified fonts'].filter(Boolean).join('; ');
  return [
"=== DESIGN DNA (authoritative - every visual decision derives from this) ===",
d.projectName?("Project: "+d.projectName+(d.industry?(" - "+d.industry):"")):"",
d.audience?("Audience: "+d.audience):"",
"Type: "+d.projectType+" | Structure: "+d.structure+" | Theme: "+d.theme+" ("+d.themeFamily+" design language)",
"COLORS - "+cols+". Saturation "+d.saturation+"/100, contrast "+d.contrast+"/100, "+d.temperature+" temperature.",
"TYPOGRAPHY - Headings: "+d.headingFont+" "+d.headingWeight+"; Body: "+d.bodyFont+"; scale "+d.fontScale+", "+d.lineHeight+" line-height, "+d.letterSpacing+" tracking. Load via Google Fonts.",
"LAYOUT - max-width "+d.maxWidth+", "+d.whitespace+" whitespace, "+d.density+" density, "+d.navigation+" nav, "+d.hero+" hero, "+d.sections+" section pattern.",
"SHAPE - "+d.borderRadius+" radius, "+d.borderWidth+" borders, "+d.shadowStyle+" shadows (depth "+d.shadowDepth+"/100).",
"EFFECTS - background "+d.bgStyle+"; surface effects: "+fx+"; glow "+d.glow+"/100.",
"COMPONENTS - "+d.buttonStyle+" buttons, "+d.cardStyle+" cards, "+d.formStyle+" forms, "+d.iconStyle+" icons. Imagery: "+d.imageStyle+".",
"MOTION - "+d.motionLevel+" level, "+d.motionStyle+" feel, "+d.easing+" easing.",
persona?("PERSONALITY - "+persona+"."):"",
psych?("EVOKE - "+psych+"."):"",
"VOICE - "+d.tone+" tone, "+d.emojiUsage+" emoji. Creativity "+d.creativity+"/100, originality "+d.originality+"/100.",
lock?("CONSTRAINTS - "+lock+"."):"",
"Output must look like a top-tier agency built it. Never generic. Perfect consistency across the whole design.",
"=== END DESIGN DNA ==="
].filter(Boolean).join("\n");
}
window.openDNA=openDNA;
function _dnaShouldApply(msgs){
  try{
    const last=[...msgs].reverse().find(m=>m.r==='u');
    const t=last?(typeof last.c==='string'?last.c:(last.d||'')):'';
    return /\b(website|web ?app|landing|page|site|ui|interface|html|css|design|component|button|form|card|dashboard|portfolio|hero|layout|build me|make me|create a|3d|mockup|frontend)\b/i.test(t);
  }catch(e){ return false; }
}
window._dnaShouldApply=_dnaShouldApply;

/* Task #1: tell the chat model EXACTLY which action-integrations are connected,
   so it never claims to send an email / post to Slack / etc. when it can't. */
function _integrationStatusPrompt(){
  try{
    if(typeof TASK_CAPABILITIES==='undefined') return '';
    const connected=[], missing=[];
    TASK_CAPABILITIES.forEach(c=>{
      (c.isConnected()?connected:missing).push(c.integration+' ('+c.api+')');
    });
    // de-dupe by integration name
    const uniq=a=>[...new Set(a)];
    let s='\n\nINTEGRATION REALITY (critical - never violate): You can only take real actions through integrations the user has actually connected. ';
    s+= uniq(connected).length ? 'Currently CONNECTED and usable: '+uniq(connected).join(', ')+'. ' : 'The user has NOT connected any action integrations yet. ';
    if(uniq(missing).length) s+='NOT connected: '+uniq(missing).join(', ')+'. ';
    s+='If the user asks you to perform an action that needs an integration that is NOT connected, do NOT claim you did it. Instead, state plainly that it requires the specific API (name it) and that they need to connect it in Integrations first. Be specific and honest.';
    return s;
  }catch(e){ return ''; }
}
window._integrationStatusPrompt=_integrationStatusPrompt;


