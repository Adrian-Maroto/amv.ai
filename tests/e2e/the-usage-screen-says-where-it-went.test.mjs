/* THE USAGE SCREEN SAYS WHERE IT WENT.

   Driven through the real page, the real API client, the real Worker and the
   real counter object: a chat outside a project, a chat inside one, a Crew
   request, and a project that lives only on another device. What is checked
   is what the page sent (the label on each request), and what the Usage
   screen then shows - by surface, and by project under its own name, with
   the ones this device cannot name said plainly rather than shown as ids. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { AMVCounter } = await import(join(ROOT, 'amv-backend.js') + '?ctr=' + Date.now());
void readFileSync;

const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
const reply = (t) => ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 95, output_tokens: 0 } } })
  + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
  + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
  + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
  + ev('message_stop', { type: 'message_stop' });

const outbound = makeOutbound();
outbound.on(/model\.example/, () => new Response(reply('Answered.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const objs = new Map();
const env = makeEnv({ APP_URL: 'http://localhost:9246', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example' });
env.AMV_COUNTER = {
  idFromName: n => n,
  get: n => {
    if (!objs.has(n)) {
      const st = new Map();
      const storage = { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, structuredClone(v)); },
        async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} };
      objs.set(n, new AMVCounter({ storage }, env));
    }
    const o = objs.get(n);
    return { fetch: (u, init) => o.fetch(new Request('https://do/', init)) };
  },
};
const L = await bootLive({ env, outbound, port: 9246 });
const { page } = L;
const EMAIL = 'where@example.com';

const labels = [];
page.on('request', r => {
  if (r.method() === 'POST' && /\/v1\/messages$/.test(r.url())) { try {
    const b = JSON.parse(r.postData() || '{}'); const last = (b.messages || []).slice(-1)[0] || {};
    const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content || '');
    labels.push(Object.assign({ said: text }, b.amv || {}));
  } catch (e) {} }
});

/* Typed only once the composer is free and a second after the last send -
   the page refuses messages closer together than that (minGapMs) - and waited
   on until the request is seen leaving. */
async function say(t) {
  await page.waitForFunction(() => S.busy === false && !!document.getElementById('mta'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const sent = labels.length;
  await page.evaluate(async (t) => {
    const box = document.getElementById('mta'); box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg();
  }, t);
  await page.waitForFunction(() => S.busy === true, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 50 && !labels.slice(sent).some(l => l.said.includes(t)); i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300); await L.settle();
}

section('Signed in');
{
  await page.evaluate(async (em) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Where'); type('#a-email', em); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  }, EMAIL);
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  ok(await page.evaluate(() => _usageServerOwned()), 'the server counts this account');
}

section('Each request says where it came from');
{
  await page.evaluate(() => { setTab('chat'); });
  await page.waitForTimeout(200);
  await say('outside any project');
  const outside = labels.find(l => /outside any project/.test(l.said));
  ok(outside && outside.surface === 'chat' && !outside.project, 'a chat outside a project is chat, with no project', outside);

  /* A project of this device's, and a new chat in it - the way its page starts one. */
  await page.evaluate(() => {
    S.workspaces = (S.workspaces || []).concat([{ id: 'wsQ3report', name: 'Quarterly report', convs: [], memory: [], created: Date.now() }]);
    _saveWorkspaces(S.workspaces);
    newChatInProject('wsQ3report');
  });
  await page.waitForTimeout(200);
  await say('inside the project');
  const inside = labels.find(l => /inside the project/.test(l.said));
  ok(inside && inside.surface === 'chat' && inside.project === 'wsQ3report', 'a chat in a project carries the project', inside);

  const n = labels.length;
  await page.evaluate(async () => { setTab('crew'); await new Promise(r => setTimeout(r, 200)); await aiComplete('plan my week'); });
  await L.settle();
  const crew = labels.find(l => /plan my week/.test(l.said));
  ok(crew && crew.surface === 'crew', 'a request made on the Crew screen is Crew', crew);
  ok(crew && !crew.project, 'and not the project whose chat happens to be open', crew);

  /* A project that exists only on another of this person's devices. */
  await page.evaluate(async () => {
    const r = await fetch(_aiBase(), { method: 'POST', headers: _aiHeaders(), body: JSON.stringify({ model: 'amv-core', max_tokens: 64, stream: true,
      messages: [{ role: 'user', content: 'from the laptop' }], amv: { surface: 'chat', project: 'wsLaptopOnly' } }) });
    await r.text();
  });
  await L.settle();
}

section('The Usage screen shows where it went');
{
  /* Expected from what was actually sent: the Crew screen may make requests
     of its own when it opens, and each is counted where it was made. */
  const count = (f) => labels.filter(f).length * 100;
  const want = { chat: count(l => l && l.surface === 'chat'), crew: count(l => l && l.surface === 'crew'),
                 outside: count(l => l && !l.project) };
  await page.evaluate(() => { S.settingsPane = 'usage'; setTab('settings'); });
  await page.waitForFunction(() => /This month/.test((document.getElementById('srv-usage') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const t = await page.evaluate(() => { const d = document.querySelector('#srv-usage details.srv-more'); if (d) d.open = true; return (document.getElementById('srv-usage') || {}).innerText || ''; });
  ok(/Where it went this month/.test(t), 'there is a section for it', t.slice(0, 400));
  const sec = t.slice(t.indexOf('Where it went this month'));
  ok(want.crew >= 100 && sec.includes('Chat\n' + want.chat.toLocaleString('en-US')) && sec.includes('Crew\n' + want.crew.toLocaleString('en-US')),
     'by surface: chat and Crew, each what was sent from it', { want, sec: sec.slice(0, 200) });
  ok(/Quarterly report[\s\S]*?100/.test(sec), 'the project by its name on this device', sec.slice(0, 400));
  ok(/A project on another device/.test(sec), 'one this device does not have, said so rather than shown as an id', sec.slice(0, 400));
  ok(!/wsQ3report|wsLaptopOnly/.test(t), 'no project id reaches the screen');
  ok(sec.includes('Not in a project\n' + want.outside.toLocaleString('en-US')), 'and the rest of the month counted as outside any project', { want: want.outside, sec: sec.slice(0, 400) });
}

section('In another language the section is translated');
{
  await page.evaluate(async (c) => { saveStr('amv_lang', c); try { _translateUI(); } catch (e) {}
    for (let i = 0; i < 50 && c !== 'en' && !_i18nPackHave(c); i++) await new Promise(s => setTimeout(s, 100)); }, 'es');
  await page.evaluate(() => { S.settingsPane = 'usage'; setTab('settings'); });
  await page.waitForFunction(() => /Dónde se usó este mes/.test((document.getElementById('srv-usage') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const t = await page.evaluate(() => (document.getElementById('srv-usage') || {}).textContent || '');
  ok(/Dónde se usó este mes/.test(t) && /Por proyecto/.test(t) && /Un proyecto en otro dispositivo/.test(t), 'Spanish: the heading, by project, and the other-device label', t.slice(0, 300));
  await page.evaluate(async (c) => { saveStr('amv_lang', c); try { _translateUI(); } catch (e) {}
    for (let i = 0; i < 50 && c !== 'en' && !_i18nPackHave(c); i++) await new Promise(s => setTimeout(s, 100)); }, 'en');
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('the-usage-screen-says-where-it-went') > 0) process.exitCode = 1;
done();
