/* A SEARCH CAN FIND IT BY MEANING - THROUGH THE PAGE.

   Oct 26 audit: hybrid retrieval. When the deployment scores passages by
   meaning (79-meaning.js), the project and library searches send their
   passages with the question and blend the scores with their word scores.
   Through the real page, the real Worker and a stand-in embedding model:
   - a passage in Spanish that shares no word with an English question is
     found, and labelled as found by meaning;
   - the exact words still come first when they are there;
   - with the model failing, the search answers on words alone, and says no
     more than words found. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
outbound.on(/model\.example/, () => new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
const vals = new Map();
let modelUp = true;
const vec = (t) => { t = t.toLowerCase(); return [/revenue|sales|ventas|ingresos|growth|crec|subieron/.test(t) ? 1 : 0, /rain|lluvia|weather|storm|harbour/.test(t) ? 1 : 0, 0.1]; };
const env = makeEnv({
  APP_URL: 'http://localhost:9258', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AI: { async run(_m, input){ if (!modelUp) throw new Error('down'); return { data: input.text.map(vec) }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9258 });
const { page } = L;
await page.evaluate(async () => {
  openAuth('signup'); await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Rui'); type('#a-email', 'rui@example.com'); type('#a-pass', 'A-real-Passw0rd!');
  document.getElementById('auth-submit').click(); await __amvSignedIn();
});
await env.AMV_KV.put('ent:rui@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
await page.evaluate(async () => {
  try { await syncEntitlement(); } catch (e) {}
  const filler = (n) => 'The harbour office opens at nine and the ferry leaves at ten. '.repeat(n);
  const ws = { id: 'wsM', name: 'Board', icon: '📈', desc: '', created: Date.now(), convs: [] };
  S.workspaces = [ws].concat(S.workspaces || []); _saveWorkspaces(S.workspaces);
  _projSaveFiles('wsM', [
    { id: 'm1', name: 'informe.txt', text: filler(30) + '\nLas ventas subieron un 14 por ciento en el tercer trimestre.\n' + filler(30), added: 2 },
    { id: 'm2', name: 'notes.txt', text: filler(20) + '\nSales growth is the first agenda item next year.\n' + filler(20), added: 1 },
  ]);
  const c = newConvObj('t'); c.wsId = 'wsM'; S.convs.unshift(c); S.cur = c.id;
});

/* The search is fetched on demand, as it is the first time a project needs it. */
ok(await page.evaluate(() => _lazyLoad('project-search.js', () => typeof window.amvProjectFileSearch === 'function')), 'the search arrives', true);

section('The deployment says it can search by meaning, and the page knows');
ok(await page.evaluate(() => _MEANING === true), 'public-config said so', true);

section('A passage with no word in common is found, and labelled');
{
  const out = await page.evaluate(() => window.amvProjectFileSearch({ query: 'revenue increase' }));
  ok(/Las ventas subieron un 14 por ciento/.test(out), 'the Spanish passage is found for an English question', out.slice(0, 300));
  ok(/informe\.txt - passage \d+ of \d+ \(found by meaning - it does not use the words searched for\)/.test(out), 'and is labelled as found by meaning, not by the words', out.slice(0, 400));
  ok(!/harbour office opens at nine and the ferry leaves at ten\. The harbour office opens at nine and the ferry leaves at ten\. The harbour/.test(out.split('informe.txt')[0] || ''), 'filler about the harbour is not offered as a match');
}

section('The exact words still come first');
{
  /* Passages are listed in file order; which comes first shows when there is
     room for only one. */
  const best = await page.evaluate(async () => {
    const files = _projFiles('wsM');
    const asked = [{ text: 'sales growth', weight: 1 }];
    const meaning = await _psMeaningScores(files, asked);
    /* Room for exactly the passage that uses the words: if the blend put the
       other first, that one would take the room instead. */
    const words = _psIndex(files.find(f => f.name === 'notes.txt')).ps.find(p => /Sales growth/.test(p.text));
    const one = amvProjectSearch(files, asked, words.text.length + 10, meaning);
    return { names: one.passages.map(p => p.name), byMeaning: one.passages.some(p => p.byMeaning), scored: Array.isArray(meaning) };
  });
  ok(best.scored, 'both rankings were in play', best);
  ok(best.names.join() === 'notes.txt' && !best.byMeaning, 'with room for one passage, it is the one that uses the words', best);
}

section('With the model failing, words alone - and no more than words found');
{
  modelUp = false;
  const out = await page.evaluate(() => window.amvProjectFileSearch({ query: 'revenue increase' }));
  ok(/nothing in them matches/.test(out) && !/Las ventas/.test(out), 'nothing matched by words, so nothing is offered', out.slice(0, 200));
  modelUp = true;
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('a-search-can-find-it-by-meaning') > 0) process.exitCode = 1;
done();
