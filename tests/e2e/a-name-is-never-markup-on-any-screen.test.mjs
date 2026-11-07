/* A NAME IS NEVER MARKUP, ON ANY SCREEN (Nov 3 audit SEC-003).

   The page draws with innerHTML in some four hundred places, and every one is
   only as safe as the escaping somebody remembered to write. The CSP is the
   wall behind them - `script-src` has no 'unsafe-inline', so an injected
   handler, a `javascript:` link or an inserted <script> never runs, which the
   first section proves by injecting past every escaper. But a missed escape
   that cannot run code can still draw: a fake sign-in form, a <style> that
   hides the real button, a link dressed as one of AMV's. So the second part
   is the fuzz the audit asked for. Every user-named thing the page keeps - a
   chat's title and messages, a memory, a project, a saved prompt, a
   workspace, the account's own name - is replaced with payloads that break
   out of text, of a double-quoted attribute and of a single-quoted one, each
   carrying a marker. Then every tab and every dialog is drawn. A marker that
   became an element or an attribute is a sink that did not escape, named by
   the screen it was found on. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const P = [
  `<b class="amvprobe">t</b>`,
  `"><b class="amvprobe">d</b><i amvprobe="1" x="`,
  `'><b class='amvprobe'>s</b><i amvprobe='1' x='`,
  `" amvprobe="1`,
  `' amvprobe='1`,
  `<img class=amvprobe src=x onerror="window.__xss=1">`,
  `<style>.amvprobe-style{}</style><form class=amvprobe action=/x><input name=p></form>`,
].join(' ');

const TABS = ['chat','dashboard','workspaces','memory','usage','billing','plans',
              'settings','help','apps','tasks','integrations','crew','market','team',
              'build:design','build:code','build:lab'];
const MODALS = {
  openCommandPalette: [], openSharedChatsManager: [], openHandoffManager: [], openSchedManager: [],
  openTaskPanel: [], openStatusPanel: [], openShortcuts: [], openMySites: [], openFeedback: [],
  openPlanCompare: [], openWhatsNew: [], openErrors: [], openResearchWatch: [],
};

const app = await bootApp({ tab: 'chat', user: { name: P, email: 'probe@x.com', ini: 'P' } });
const { page, errors } = app;

section('Past every escaper, injected markup still runs no code');
{
  const r = await page.evaluate(async () => {
    window.__xss = 0;
    const box = document.createElement('div'); document.body.appendChild(box);
    box.innerHTML = '<img src=x onerror="window.__xss=1"><svg onload="window.__xss=1"></svg>' +
      '<a id="amv-js-link" href="javascript:window.__xss=1">x</a><script>window.__xss=1<\/script>' +
      '<iframe srcdoc="<script>parent.__xss=1<\/script>"></iframe>';
    try { document.getElementById('amv-js-link').click(); } catch (e) {}
    await new Promise(x => setTimeout(x, 500));
    box.remove();
    return window.__xss;
  });
  ok(r === 0, 'a handler, a javascript: link, a script and a srcdoc frame put straight into innerHTML all stay inert', r);
}

/* Poison what the page keeps, in its own stores, then let it load them. */
const seeded = await page.evaluate((P) => {
  const KEYS = /^(title|name|text|label|desc|description|c|content|filename|fileName|note|summary|instructions|goal|prompt|cat|tag|folder)$/;
  const poison = (v, d) => {
    if (d > 6) return v;
    if (Array.isArray(v)) return v.map(x => poison(x, d + 1));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = (typeof x === 'string' && KEYS.test(k)) ? P + ' ' + k : poison(x, d + 1); return o; }
    return v;
  };
  const now = Date.now();
  const conv = { id: 'cprobe1', title: P, msgs: [{ r: 'u', c: P, _t: now }, { r: 'a', c: 'Answer ' + P, _t: now }], model: 'auto', starred: true, created: now };
  try { S.convs = [conv, ...(S.convs || [])]; S.cur = conv.id; } catch (e) {}
  try { S.memory = [{ id: 'mprobe', text: P, added: now }, ...(S.memory || [])]; } catch (e) {}
  try { S.prompts = poison([{ id: 'pprobe', title: P, cat: P, text: P, custom: true }, ...(S.prompts || [])], 0); } catch (e) {}
  try { S.workspaces = poison(S.workspaces || [], 0); } catch (e) {}
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/^amv_/.test(k) || /amv_(user|mk|rl|sp|se|model|theme|lang)$/.test(k)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v && typeof v === 'object') { localStorage.setItem(k, JSON.stringify(poison(v, 0))); n++; }
    } catch (e) {}
  }
  try {
    const projs = JSON.parse(localStorage.getItem('amv_projects') || '[]');
    projs.unshift({ id: 'prprobe', name: P, instructions: P, files: [{ name: P, text: P }], created: now });
    localStorage.setItem('amv_projects', JSON.stringify(projs));
  } catch (e) {}
  return n;
}, P);
ok(seeded >= 1, 'the saved stores were poisoned', seeded);

const probe = () => page.evaluate(() => {
  const hits = [...document.querySelectorAll('.amvprobe,[amvprobe]')];
  return { n: hits.length, xss: window.__xss || 0,
    where: hits.slice(0, 3).map(h => { let p = h.parentElement, id = ''; while (p && !id) { id = p.id || (p.className && String(p.className).split(' ')[0]) || ''; p = p.parentElement; } return h.tagName.toLowerCase() + ' in ' + id; }) };
});

section('Every tab draws the poisoned names as text');
const bad = [];
for (const tab of TABS) {
  await page.evaluate(t => {
    try {
      if (t.indexOf('build:') === 0) { setTab('build'); setBuildMode(t.slice(6)); }
      else setTab(t);
    } catch (e) {}
    try { if (typeof renderSidebar === 'function') renderSidebar(); } catch (e) {}
  }, tab);
  await page.waitForTimeout(400);
  const r = await probe();
  if (r.n || r.xss) bad.push(tab + ': ' + r.n + ' (' + r.where.join(', ') + ')');
}
ok(bad.length === 0, 'no tab turned a name into an element or an attribute', bad);

section('The chat itself, with the poisoned conversation open');
{
  await page.evaluate(() => { try { setTab('chat'); renderChatMsgs(); } catch (e) {} });
  await page.waitForTimeout(400);
  const r = await probe();
  ok(r.n === 0 && r.xss === 0, 'its title, the question and the answer are text', r);
  const shown = await page.evaluate(() => document.body.innerText.includes('class="amvprobe"'));
  ok(shown, 'and the payload is visible as the characters somebody typed - escaped, not dropped');
}

section('Every dialog draws them as text too');
{
  const badM = [];
  for (const [fn, args] of Object.entries(MODALS)) {
    const r = await page.evaluate(async ([name, argv]) => {
      const o = document.getElementById('ovr'); if (o) { o.innerHTML = ''; o.className = ''; }
      if (typeof window[name] !== 'function') return { missing: true };
      try { window[name].apply(null, argv); } catch (e) { return { threw: String(e && e.message).slice(0, 120) }; }
      await new Promise(x => setTimeout(x, 400));
      const hits = document.querySelectorAll('.amvprobe,[amvprobe]').length;
      try { closeOvr(); } catch (e) {}
      return { hits, xss: window.__xss || 0 };
    }, [fn, args]);
    if (r.hits || r.xss) badM.push(fn + ': ' + r.hits);
  }
  ok(badM.length === 0, 'no dialog turned a name into an element or an attribute', badM);
}

report(errors);
await app.close();
done();
