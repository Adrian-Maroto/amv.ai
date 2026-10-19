/* A PROJECT FINDS THE PART YOU ASKED ABOUT.

   A project's files used to go whole, newest first, up to one message's worth
   - and whatever did not fit was named and left out. So the contract added
   first was the file a question about the contract never reached.

   Now, when the files are larger than one message holds, they are searched on
   this device for each message and the passages that match it best are sent,
   from any file. This drives that in a real browser:
   - files that fit still go whole, and the search is never fetched;
   - if the search cannot be fetched, the files go as before and say what was
     left out - nothing fails;
   - the oldest file's one relevant sentence reaches the prompt;
   - Chinese, which has no spaces, is found; an accent typed or not is the
     same word; a row of a table arrives with its header;
   - a follow-up ("and how is it paid?") still finds what the question before
     it was about;
   - when nothing matches, the prompt says the beginning of each file was sent
     instead, not that it searched and found;
   - the real send path carries it to the model, and the project page says
     what happens. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Rui', email: 'rui@example.com', ini: 'R' } });
const { page, errors } = app;

/* Filler that matches nothing asked below: varied, so no single word is
   everywhere, and long enough that the files are far past one message. */
await page.evaluate(() => {
  const W = 'harbour lantern meadow quarry ribbon saddle timber velvet willow anchor blossom candle dolphin ember falcon glacier hollow island jasmine kettle'.split(' ');
  let n = 7;
  const filler = (chars) => { let s = ''; while (s.length < chars) { n = (n * 1103515245 + 12345) % 2147483648; s += W[n % W.length] + (n % 9 === 0 ? '.\n' : ' '); } return s; };
  const ZH = '天气河流山脉城市道路花园学校图书馆火车音乐'.split('');
  let zh = ''; while (zh.length < 6000) { n = (n * 1103515245 + 12345) % 2147483648; zh += ZH[n % ZH.length] + (n % 17 === 0 ? '。\n' : ''); }
  let csv = 'region,month,revenue\n';
  const R = ['Lisboa', 'Porto', 'Madrid', 'Valencia'], M = ['January', 'February', 'April', 'May'];
  for (let i = 0; i < 1600; i++) csv += R[i % 4] + ',' + M[(i >> 2) % 4] + ',' + (10000 + i * 7) + '\n';
  csv += 'Málaga,March,98765\n';
  for (let i = 0; i < 400; i++) csv += R[i % 4] + ',' + M[(i >> 2) % 4] + ',' + (20000 + i * 3) + '\n';
  window.__files = [
    /* Newest first, as the project keeps them: the contract is the OLDEST. */
    { id: 'f4', name: '会议记录.txt', text: zh.slice(0, 3000) + '\n预算批准为五百万元。\n' + zh.slice(3000), added: 4 },
    { id: 'f3', name: 'sales.csv', text: csv, added: 3 },
    { id: 'f2', name: 'notes.txt', text: filler(70000), added: 2 },
    { id: 'f1', name: 'contract.txt', text: filler(30000) + '\nThe early termination fee is 2,750 euros, payable by bank transfer within 30 days.\n' + filler(30000), added: 1 },
  ];
  const ws = { id: 'wsR', name: 'Rental', icon: '🏠', desc: '', created: Date.now(), convs: [] };
  S.workspaces = [ws].concat(S.workspaces || []);
  _saveWorkspaces(S.workspaces);
  const c = newConvObj('t'); c.wsId = 'wsR'; S.convs.unshift(c); S.cur = c.id;
});
const ask = (...said) => page.evaluate((said) => _projectContextFor(said.map((c, i) => ({ r: i % 2 ? 'a' : 'u', c }))), said);

section('Files that fit go whole, and nothing is fetched for it');
{
  await page.evaluate(() => _projSaveFiles('wsR', [{ id: 's1', name: 'short.txt', text: 'The deposit is two months of rent.', added: 1 }]));
  const ctx = await ask('How much is the deposit?');
  ok(/=== short\.txt ===\nThe deposit is two months of rent\./.test(ctx), 'the file is in the prompt whole', ctx.slice(-200));
  ok(await page.evaluate(() => typeof window.amvProjectSearch === 'undefined' && !document.querySelector('script[src="project-search.js"]')),
     'and the search was never fetched', true);
  ok(!/passage/.test(ctx), 'nor described as a search', ctx.slice(-200));
}

section('If the search cannot be fetched, the files go as before and say what was left out');
{
  await page.evaluate(() => _projSaveFiles('wsR', window.__files));
  /* Pointed at a file that is not there, in the page: the service worker
     answers before a network rule would, so the failure is made where the
     script is asked for. */
  await page.evaluate(() => {
    const add = document.head.appendChild.bind(document.head);
    window.__restoreHead = () => { document.head.appendChild = add; };
    document.head.appendChild = (el) => { if (el.tagName === 'SCRIPT' && /project-search\.js$/.test(el.src)) el.src = 'project-search-missing.js'; return add(el); };
  });
  const ctx = await ask('What is the early termination fee?');
  ok(/Not included, too large for one request/.test(ctx) && /contract\.txt/.test(ctx.slice(ctx.indexOf('Not included'))),
     'the newest files whole, the rest named - never silent', ctx.slice(-260));
  ok(!/2,750/.test(ctx), 'which is the old failure: the oldest file is the one left out', true);
  await page.evaluate(() => window.__restoreHead());
}

section('Larger than one message: the passage asked about is found, in the oldest file');
{
  const ctx = await ask('What is the early termination fee in the contract?');
  ok(/2,750 euros/.test(ctx), 'the one sentence that answers it reaches the prompt', ctx.length);
  ok(/searched them for this message and these are the passages that match it best/.test(ctx) && /never guess at what the files say/.test(ctx),
     'and the model is told these are search results, with the rest not sent', ctx.slice(0, 0));
  ok(/=== contract\.txt - passage \d+ of \d+ ===/.test(ctx), 'each passage says which file and which part it is', (ctx.match(/=== contract[^\n]*/) || [''])[0]);
  const files = await page.evaluate(() => window.__files.reduce((n, f) => n + f.text.length, 0));
  ok(ctx.length < 120000 + 6000 && files > 150000, 'within the same budget, from files well past it', { prompt: ctx.length, files });
  const first = ctx.indexOf('=== contract.txt - passage');
  ok(first >= 0 && ctx.indexOf('2,750') > first, 'the answer sits inside a contract passage', first);
}

section('Every language: Chinese without spaces, an accent typed or not, a table row with its header');
{
  const zh = await ask('预算是多少？');
  ok(/预算批准为五百万元/.test(zh) && /=== 会议记录\.txt - passage/.test(zh) && /passages that match it best/.test(zh),
     'a Chinese question finds the Chinese sentence - by matching it, not by sending the start of every file', (zh.match(/=== 会议[^\n]*/) || [''])[0]);
  /* Only the place name is a word the files have, and its accent is inside
     the first five letters, so nothing but folding the accent can find it. */
  const row = await ask('what did malaga make?');
  const at = row.indexOf('Málaga,March,98765');
  const head = row.lastIndexOf('=== sales.csv', at);
  ok(at > 0 && /passages that match it best/.test(row), 'typed without the accent, the row with it is found', at);
  ok(head >= 0 && row.slice(head, at).split('\n')[1] === 'region,month,revenue', 'and the passage it is in starts with the table header', row.slice(head, head + 120));
}

section('A follow-up still finds what the question before it was about');
{
  /* "How do I settle it" shares no word with the files; only the question
     before it can find the passage. */
  const ctx = await ask('What is the early termination fee?', 'It is in the contract.', 'How do I settle it?');
  ok(/2,750 euros, payable by bank transfer/.test(ctx) && /passages that match it best/.test(ctx), 'the earlier question still counts, at half weight', ctx.length);
}

section('When nothing matches, it says the start of each file was sent');
{
  const ctx = await ask('xyzzy plugh');
  ok(/nothing in them matched it, so these are the beginning of each file/.test(ctx), 'it does not claim a match it did not find', ctx.slice(0, 0));
  ok(ctx.length < 120000 + 6000, 'and it still stops at one message’s worth', ctx.length);
  for (const name of ['contract.txt', 'notes.txt', 'sales.csv', '会议记录.txt'])
    ok(ctx.includes('=== ' + name + ' - passage 1 of'), 'the start of ' + name + ' is there', name);
}

section('The real send path carries the passages to the model');
{
  const sys = await page.evaluate(async () => {
    window.__amvStreamIdleMs = 250;
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
    S.busy = false;
    const bodies = [];
    window.fetch = async (u, o) => {
      if (o && typeof o.body === 'string') bodies.push(o.body);
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"It is 2,750 euros."}}\n\ndata: {"type":"message_stop"}\n\n')); c.close(); } }) };
    };
    document.getElementById('mta').value = 'How much is the early termination fee?';
    sendMsg();
    for (let i = 0; i < 40 && !bodies.some(b => b.includes('termination fee is')); i++) await new Promise(r => setTimeout(r, 100));
    const b = bodies.find(x => x.includes('"system"')) || '';
    try { const j = JSON.parse(b); return Array.isArray(j.system) ? j.system.map(x => x.text || '').join('\n') : String(j.system || ''); } catch (e) { return ''; }
  });
  ok(/The early termination fee is 2,750 euros/.test(sys) && /passages that match it best/.test(sys), 'the system prompt sent holds the passage that answers', sys.length);
}

section('The project page says what happens');
{
  await page.evaluate(() => openProjectPanel('wsR'));
  const note = await page.$$eval('#pj-body .pj-note', es => es.map(e => e.textContent).join(' | '));
  ok(/more than one message holds: each message is sent the passages that match it best/.test(note), 'it says the files are searched for each message', note);
  await page.evaluate(() => closeOvr());
}

/* The one error this suite causes on purpose: the host answering the missing
   file with its own page, parsed as a script. Anything else is a real one. */
const real = errors.filter(e => !/^Unexpected token '<'$/.test(String(e)));
ok(real.length === 0, 'no page errors besides the one injected above', errors);
await app.close();
if (report('a-project-finds-the-part-you-asked-about') > 0) process.exitCode = 1;
done();
