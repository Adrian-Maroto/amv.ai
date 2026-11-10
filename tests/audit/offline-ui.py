"""Offline component checks, not live E2E/CSP/auth/provider verification.
Requires Python playwright and beautifulsoup4 plus a local Chromium executable.
Never navigates a browser to the app; all network requests are blocked.
"""
from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import json, sys, os
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
out=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/amv-ui-audit');out.mkdir(parents=True,exist_ok=True)
html=BeautifulSoup((root/'index.html').read_text(),'html.parser')
for s in html.find_all('script'):s.decompose()
for m in html.find_all('meta',attrs={'http-equiv':True}):
 if m.get('http-equiv','').lower()=='content-security-policy':m.decompose()
for l in html.find_all('link'):
 if l.get('href','').startswith(('http','//')):l.decompose()
m=html.find('meta',attrs={'name':'amv-api-base'})
if m:m['content']=''
results=[];errors=[]
def result(name,good,detail=None):
 results.append({'name':name,'pass':bool(good),'evidence':detail});print(('PASS ' if good else 'FAIL ')+name,flush=True)
def run(name,fn):
 try:good,detail=fn();result(name,good,detail)
 except Exception as e:result(name,False,{'error':str(e)[:1200]})
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True)
 page=b.new_page(viewport={'width':1440,'height':1000})
 page.route('**/*',lambda route:route.abort())
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(str(html),wait_until='domcontentloaded')
 page.evaluate('''() => {
 const mk=()=>{const m=new Map();return {get length(){return m.size},getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]||null};};
 for(const k of ['localStorage','sessionStorage'])Object.defineProperty(window,k,{value:mk(),configurable:true});
 window.fetch=async()=>{throw new Error('Offline fixture: network disabled');};
 window.__AMV_OWNER_EMAIL__='audit@amv.test';
 localStorage.setItem('amv_cookie_consent',JSON.stringify({essential:true}));
 }''')
 page.add_script_tag(content=(root/'app.js').read_text());page.wait_for_timeout(120)
 for name in ['crew-data.js','crew-view.js','integrations-view.js','settings-panes.js','spending.js','invest.js','team-projects.js','help-faqs.js']:
  page.add_script_tag(content=(root/name).read_text())
 page.evaluate("() => {S.user={name:'Synthetic audit user',email:'audit@amv.test',ini:'A'};goApp();document.getElementById('ck')?.remove();}")
 for width in [390,768,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  for tab in ['chat','crew','tasks','integrations','spend','team','help','billing']:
   try:
    page.evaluate('(t)=>{closeOvr();setTab(t);}',tab);page.wait_for_timeout(160)
    detail=page.evaluate('''() => {const host=document.getElementById('vc');return {title:host?.innerText.slice(0,100),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,spills:[...host.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.left>=0&&r.left<innerWidth&&r.right>innerWidth+3&&s.visibility!=='hidden'&&s.position!=='fixed';}).slice(0,12).map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'svg',right:e.getBoundingClientRect().right}))};}''')
    result('Layout '+tab+' at '+str(width),detail['pageWidth']<=width+3 and not detail['spills'],detail)
    page.screenshot(path=str(out/(tab+'-'+str(width)+'.png')))
   except Exception as e:result('Layout '+tab+' at '+str(width),False,{'error':str(e)[:600]})
 page.set_viewport_size({'width':390,'height':1000})
 page.evaluate("setTab('chat')");page.wait_for_timeout(100)
 def composer():
  d=page.evaluate(r'''() => {const e=$('mta');e.value='Short';e.dispatchEvent(new Event('input',{bubbles:true}));const a=e.offsetHeight;e.value=Array.from({length:8},(_,i)=>'Line '+i+': a longer instruction.').join('\n');e.dispatchEvent(new Event('input',{bubbles:true}));const b=e.offsetHeight;e.value=('An intentionally long instruction.\n').repeat(100);e.dispatchEvent(new Event('input',{bubbles:true}));return {short:a,longer:b,capped:e.offsetHeight,overflow:getComputedStyle(e).overflowY};}''')
  return d['longer']>d['short'] and d['capped']<=522 and d['overflow']=='auto',d
 run('Composer grows and bounds very long input',composer)
 page.evaluate("() => {newChat();setMsgs([{r:'u',c:'A synthetic question'},{r:'a',c:'A synthetic answer for toolbar checks.'}]);renderChatMsgs();}")
 page.wait_for_timeout(100)
 def toolbar():
  d=page.evaluate('''() => {const required=['copy-a','like-up','like-down','speak','share-answer','answer-more'];return required.map(a=>{const e=document.querySelector('[data-action="'+a+'"]');return {action:a,exists:!!e,visible:!!e&&e.getBoundingClientRect().width>0};});}''')
  return all(x['visible'] for x in d),d
 run('Reply toolbar has all six primary actions',toolbar)
 def more():
  page.locator('[data-action="answer-more"]').click();opened=page.locator('[data-action="answer-more"]').get_attribute('aria-expanded');page.keyboard.press('Escape');closed=page.locator('[data-action="answer-more"]').get_attribute('aria-expanded');return opened=='true' and closed=='false',{'opened':opened,'closed':closed}
 run('More controls open and Escape closes them',more)
 def share():
  d=page.evaluate('''async() => {window.__shared=null;Object.defineProperty(navigator,'share',{value:async x=>{window.__shared=x;},configurable:true});await shareAnswer(1);return window.__shared;}''')
  return d=={'title':'AMV answer','text':'A synthetic answer for toolbar checks.'},d
 run('Share sends only the selected answer text',share)
 page.screenshot(path=str(out/'chat-toolbar-390.png'))
 page.evaluate("setTab('tasks')");page.wait_for_timeout(100)
 run('Task count is real, not an inflated catalog claim',lambda:(page.evaluate('_taskCatalog().length')==196,{'count':page.evaluate('_taskCatalog().length')}))
 def tasks():
  page.locator('#task-search').fill('receipt');a=page.locator('.task-card').count();page.locator('#task-search').fill('');page.locator('#task-mode').select_option('crew');d=page.locator('#task-count').inner_text();return a>0 and d.startswith('100 matching'),{'receiptResults':a,'crewCount':d}
 run('Task search and Chat/Crew filter change the result set',tasks)
 def country():
  page.locator('#tasks-country').select_option('ES');name=page.locator('#task-count').inner_text();old=page.evaluate('_cwCountryGuess()');page.evaluate("_cwSetCountry('NOT-A-COUNTRY')");new=page.evaluate('_cwCountryGuess()');return 'Spain' in name and old==new=='ES',{'label':name,'old':old,'afterInvalid':new}
 run('Country selection changes context and rejects unknown codes',country)
 page.evaluate("setTab('integrations')");page.wait_for_timeout(150)
 run('Unavailable regional data is not shown as verified connections',lambda:('could not' in page.locator('#regional-connections').inner_text().lower() or 'unavailable' in page.locator('#regional-connections').inner_text().lower(),{'text':page.locator('#regional-connections').inner_text()}))
 # UI prerequisites are intentionally stubbed here; this is not a permission test.
 page.evaluate("() => {setTab('crew');window.__oldMissing=_cwNeedsMissing;window.__oldAllowed=_planAllowsCrew;_cwNeedsMissing=()=>['Synthetic mail connection'];_planAllowsCrew=()=>true;window.__job=_cwJobs()[0].id;cwPeek(window.__job);}")
 page.wait_for_timeout(250)
 run('Missing prerequisite shows Connect, not an unsafe setup button',lambda:(page.locator('#cwp-need-go').count()==1 and page.locator('#cwp-go').count()==0,{'connect':page.locator('#cwp-need-go').count(),'setup':page.locator('#cwp-go').count()}))
 page.screenshot(path=str(out/'crew-missing-390.png'))
 page.evaluate("() => {closeOvr();_cwNeedsMissing=()=>[];cwPeek(window.__job);}")
 page.wait_for_timeout(250)
 run('Satisfied prerequisites hide redundant Connect controls',lambda:(page.locator('#cwp-need-go').count()==0 and page.locator('#cwp-go').count()==1,{'connect':page.locator('#cwp-need-go').count(),'setup':page.locator('#cwp-go').count()}))
 def schedule():
  page.locator('#cwp-every').select_option('weekly');page.locator('#cwp-time').fill('09:35');page.locator('#cwp-day').select_option('2');page.evaluate("() => {window.__oldToggle=cwToggle;cwToggle=(id)=>{window.__scheduled=id;};}");page.locator('#cwp-go').click();d=page.evaluate("() => {const j=_cwJobs().find(x=>x.id===window.__job);cwToggle=window.__oldToggle;return {id:window.__scheduled,sched:j.sched,tz:j.tz,every:j.every};}");return d.get('id') is not None and d['sched']=={'cad':'weekly','hour':9,'minute':35,'days':[2]} and bool(d['tz']),d
 run('Job dialog saves the exact requested schedule',schedule)
 page.evaluate("() => {_cwNeedsMissing=window.__oldMissing;_planAllowsCrew=window.__oldAllowed;}")
 result('No uncaught JavaScript errors in this offline fixture',not errors,errors)
 b.close()
summary={'method':'Offline DOM and component fixtures with actual bundles; CSP removed; all network blocked; not live E2E, provider, authorization or deployment proof. Crew gating stubs only in UI-specific checks.','passed':sum(x['pass'] for x in results),'failed':sum(not x['pass'] for x in results),'results':results}
(out/'results.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({k:summary[k] for k in ['passed','failed']}))
sys.exit(0 if not summary['failed'] else 1)
