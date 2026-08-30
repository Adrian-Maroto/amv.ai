import { bootApp } from './tests/lib/harness.mjs';
const app = await bootApp({ tab:'chat', user:{name:'T',email:'t@x.com',ini:'T'} });
const r = await app.page.evaluate(async () => {
  // churn like the earlier sections of the suite do
  for (const t of ['studio','dev','lab','studio','dev']) { setTab(t); await new Promise(s=>setTimeout(s,120)); }
  _DEV.log = [{ role:'sys', text:'x' }];
  _devSetFile('a.js', 'console.log(1)', 'js');
  setTab('dev'); await new Promise(s=>setTimeout(s,400));
  const out = { beforeTab:S.tab, beforeMode:_buildMode(),
                activePath:_DEV.activePath, curCode:String(_DEV.curCode||'').slice(0,20) };
  const btn = document.getElementById('dev-tolab');
  out.hasBtn = !!btn;
  if (btn) { btn.click(); await new Promise(s=>setTimeout(s,900)); }
  out.tab = S.tab; out.mode = _buildMode();
  out.labCode = (document.getElementById('lab-code')||{}).value || '';
  return out;
});
console.log(JSON.stringify(r,null,1));
await app.close();
