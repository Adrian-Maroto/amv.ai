/* THE SETTING THAT DECIDES WHAT HAPPENS TONIGHT.

   Three levels and a record of what ran are worth nothing as server behaviour
   alone. The person setting them is doing it on a screen, and there are two
   ways that screen can be wrong in a way that matters.

   It can say the setting saved when it did not - and somebody who believes they
   have switched off autonomous sending, and has not, is worse off than somebody
   who never tried, because they have stopped watching.

   And a job row can describe what the job is CONFIGURED to do rather than what
   will actually happen. A row reading "Autonomous - results are delivered for
   you" under an account ceiling that stops it is the single sentence on this
   screen that must never be wrong, and it is the one a naive implementation
   gets wrong, because the job's own field is the obvious thing to render.

   Driven against the real Worker, then the real cron, so the screen is checked
   against what the server actually did rather than against itself. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const modelCalls = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, () => {
  modelCalls.push(1);
  return { content: [{ type: 'text', text: 'the finished work' }], usage: { input_tokens: 100, output_tokens: 200 } };
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9185',
  AMV_MODEL_KEY: 'k',
  MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }),
  },
});

const L = await bootLive({ env, outbound, port: 9185 });
const { page } = L;
const EMAIL = 'ceiling@example.com';
const PW = 'A-real-Passw0rd!';
const KV = env.AMV_KV;
const rec = async () => { try { return JSON.parse(await KV.get('auto:' + EMAIL) || '{}'); } catch (e) { return {}; } };

async function putJob(approval) {
  const r = (await rec()) || {};
  r.items = [{ id: 'j1', detail: 'Write my weekly summary', active: true, next: Date.now() - 60000,
               interval: 86400000, kind: 'task', approval, notify: 'app' }];
  await KV.put('auto:' + EMAIL, JSON.stringify(r));
}
async function cron() {
  modelCalls.length = 0;
  const pend = [];
  await L.worker.scheduled({ cron: '*/5 * * * *' }, env,
    { waitUntil: (p) => pend.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} });
  await Promise.all(pend);
}
const crew = async () => page.evaluate(async () => {
  if (typeof window._autoRefresh === 'function') { try { await window._autoRefresh(); } catch (e) {} }
  setTab('crew');
  await new Promise(x => setTimeout(x, 900));
  const vc = document.getElementById('vc');
  return (vc.textContent || '').replace(/\s+/g, ' ').trim();
});

section('An account that can run background work');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Ceiling'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await __amvSignedIn();
  }, [EMAIL, PW]);
  await KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} await new Promise(x => setTimeout(x, 500)); });
  ok((await page.evaluate(() => loadStr('amv_plan'))) === 'ultra', 'signed in on a plan that schedules', true);
}

section('The three levels are three statements, not three words');
{
  /* Somebody is choosing what happens tonight. "Approve before action" is a
     category name; the screen has to say the thing. */
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 900));
    const sec = document.getElementById('mc-ceiling');
    if (!sec) return { found: false };
    const opts = [...sec.querySelectorAll('.mc-lv-opt')];
    return {
      found: true,
      n: opts.length,
      levels: opts.map(o => o.dataset.darg),
      says: opts.map(o => (o.querySelector('.mc-lv-s') || {}).textContent || ''),
      checked: opts.filter(o => o.getAttribute('aria-checked') === 'true').map(o => o.dataset.darg),
      group: !!sec.querySelector('[role="radiogroup"]'),
    };
  });
  ok(r.found && r.n === 3, 'all three are on the screen', r);
  ok(r.levels.join(',') === 'suggest,require,auto', 'in order, least free first', r.levels);
  ok(r.says.every(s => s.length > 60), 'each says what actually happens, at length', r.says.map(s => s.length));
  ok(r.checked.length === 1 && r.checked[0] === 'auto',
     'and exactly one is selected - the default an untouched account has always had', r.checked);
  ok(r.group, 'announced as a group of choices to a screen reader', r.group);
}

section('Choosing one reaches the server');
{
  const r = await page.evaluate(async () => {
    document.querySelector('.mc-lv-opt[data-darg="require"]').click();
    await new Promise(x => setTimeout(x, 1000));
    const sec = document.getElementById('mc-ceiling');
    return {
      checked: [...sec.querySelectorAll('.mc-lv-opt')].filter(o => o.getAttribute('aria-checked') === 'true').map(o => o.dataset.darg),
    };
  });
  await L.settle();
  ok(r.checked[0] === 'require', 'the screen shows the new setting', r.checked);
  const d = await rec();
  ok(d.ceiling === 'require', 'and the SERVER holds it, which is where it is enforced', d.ceiling);
  ok(L.hit(/\/auto\/update/).length > 0, 'having really been sent', L.hit(/\/auto\/update/).length);
}

section('A job row says what will happen, not what the job is set to');
{
  /* The sentence that must never be wrong. The job says auto; the account says
     ask first; tonight it asks first. */
  await putJob('auto');
  await crew();
  /* Read the ROW, not the page. "Ask first" also appears in the section
     heading that explains the two modes, so testing the whole screen's text
     passed while the row itself said "Autonomous" - a check that agreed with
     the bug. */
  const row = await page.evaluate(() => {
    const el = document.querySelector('#mc-sched .mc-sched-row');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  });
  ok(row !== null, 'the job has a row on the screen', row);
  ok(/Ask first/i.test(row), 'and the row itself reads as ask-first', row);
  ok(!/Autonomous/i.test(row), 'and does NOT claim it will deliver on its own', row);
  ok(/held back/i.test(row), 'saying plainly that the account setting is holding it back', row);
}

section('And the cron agrees with the screen');
{
  /* The screen could say the right thing and the server still do the wrong
     one. This is the only assertion that rules that out. */
  await cron();
  ok(modelCalls.length === 1, 'the job ran', modelCalls.length);
  const ap = await KV.get('approvals:' + EMAIL);
  const items = ap ? (JSON.parse(ap).items || []) : [];
  ok(items.length === 1, 'and stopped for approval, exactly as the row promised', items.length);
}

section('Suggest only spends nothing, and the screen says so');
{
  await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 800));
    document.querySelector('.mc-lv-opt[data-darg="suggest"]').click();
    await new Promise(x => setTimeout(x, 1000));
  });
  await L.settle();
  ok((await rec()).ceiling === 'suggest', 'the account is set to suggest only', (await rec()).ceiling);

  await putJob('auto');
  await cron();
  ok(modelCalls.length === 0, 'nothing was generated at all', modelCalls.length);

  const text = await crew();
  ok(/Suggest only/i.test(text), 'and the job row says it will not run until asked', /Suggest only/i.test(text));
}

section('The record shows what really happened, including what it cost');
{
  const r = await page.evaluate(async () => {
    const sec = document.getElementById('mc-activity');
    if (!sec) return { found: false };
    const rows = [...sec.querySelectorAll('.mc-act-row')];
    return {
      found: true,
      n: rows.length,
      text: (sec.textContent || '').replace(/\s+/g, ' ').trim(),
      states: rows.map(x => (x.querySelector('.mc-act-st') || {}).textContent || ''),
    };
  });
  ok(r.found && r.n >= 2, 'every run is listed', r.n);
  ok(/Not run - suggest only/i.test(r.states.join('|')), 'a suggested run says it was not run', r.states);
  ok(/Waiting for your approval/i.test(r.states.join('|')), 'and an earlier one says it is waiting', r.states);
  ok(/Total spent/i.test(r.text), 'with the total spent on unattended work', true);
  ok(/nothing|\$0/i.test(r.text), 'and a run that cost nothing says nothing, not a blank', r.text.slice(0, 200));
  ok(!/undefined|NaN|\[object/i.test(r.text), 'with no placeholder leaking through', (r.text.match(/undefined|NaN/) || [])[0]);
}

section('A run that FAILED is in the record too');
{
  /* The row somebody is actually looking for. A job that has produced nothing
     for a week is either failing nightly or has had nothing to say, and those
     call for opposite responses. */
  await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 700));
    document.querySelector('.mc-lv-opt[data-darg="auto"]').click();
    await new Promise(x => setTimeout(x, 900));
  });
  await L.settle();
  await putJob('auto');

  const restore = outbound.calls.length;
  outbound.on(/model\.example/, () => { throw new Error('the model was unreachable'); });
  /* Registered handlers are tried in order and the first match wins, so the
     original stub still answers. Break it at the source instead. */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (/model\.example/.test(String(u))) throw new Error('the model was unreachable');
    return realFetch(u, o);
  };
  await cron();
  globalThis.fetch = realFetch;
  ok(restore >= 0, 'the model was made to fail', true);

  const r = await page.evaluate(async () => {
    if (typeof window._autoRefresh === 'function') { try { await window._autoRefresh(); } catch (e) {} }
    setTab('crew');
    await new Promise(x => setTimeout(x, 900));
    const sec = document.getElementById('mc-activity');
    const err = sec ? sec.querySelector('.mc-act-row.err') : null;
    return { hasErr: !!err, text: err ? (err.textContent || '').replace(/\s+/g, ' ').trim() : '' };
  });
  ok(r.hasErr, 'the failed run is on the screen, marked as a failure', r);
  ok(/did not complete/i.test(r.text), 'saying so in words', r.text.slice(0, 120));
}

section('A setting that could not be saved never looks saved');
{
  /* The worst outcome available here: somebody believes autonomous sending is
     off, it is not, and they have stopped watching because the screen agreed
     with them. */
  const r = await page.evaluate(async () => {
    /* Clear what is already on screen first. Reading "the toast" found the
       SUCCESS message left over from the previous case and reported that a
       failure had been announced cheerfully - a passing assertion about the
       wrong element. */
    document.querySelectorAll('.toast, #toast, [class*="toast"]').forEach(t => t.remove());
    const orig = window._autoCeiling;
    window._autoCeiling = async () => { throw new Error('the server refused it'); };
    document.querySelector('.mc-lv-opt[data-darg="suggest"]').click();
    await new Promise(x => setTimeout(x, 900));
    const sec = document.getElementById('mc-ceiling');
    const checked = [...sec.querySelectorAll('.mc-lv-opt')].filter(o => o.getAttribute('aria-checked') === 'true').map(o => o.dataset.darg);
    const toastText = [...document.querySelectorAll('.toast, #toast, [class*="toast"]')]
      .map(t => t.textContent || '').join(' | ');
    window._autoCeiling = orig;
    return { checked, toastText };
  });
  ok(r.checked[0] === 'auto', 'the screen still shows the level that is really in force', r.checked);
  ok(/not save|UNCHANGED|refused/i.test(r.toastText), 'and says the jobs are unchanged', r.toastText.slice(0, 140));
  const d = await rec();
  ok(d.ceiling === 'auto', 'which matches the server', d.ceiling);
}

section('It works on a phone and without a mouse');
{
  /* role="radio" is a promise about behaviour, not a label. A screen reader
     announces "1 of 3" and the person reaches for the arrow keys; three
     buttons that all sit in the tab order and ignore arrows announce
     themselves as one thing and behave as another. */
  const kb = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 900));
    const opts = [...document.querySelectorAll('.mc-lv-opt')];
    const tabbable = opts.filter(o => o.getAttribute('tabindex') === '0');
    const selected = opts.filter(o => o.getAttribute('aria-checked') === 'true');
    /* Defensive: with no tab stop at all this used to throw inside evaluate and
       take the whole file down, so a real regression exited without reporting a
       single failure. A missing tab stop has to FAIL, loudly, not crash. */
    const start = tabbable[0] || opts[0];
    if (!start) return { focusable: false, tabbable: 0, wasSelected: [], after: [], stops: 0 };
    start.focus();
    const focusable = document.activeElement === start;

    /* Arrow to the next one and let it settle - moving selects, which is what
       a radio group does and what makes this usable with no mouse at all. */
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise(x => setTimeout(x, 1200));
    const after = [...document.querySelectorAll('.mc-lv-opt')]
      .filter(o => o.getAttribute('aria-checked') === 'true').map(o => o.dataset.darg);
    const stops = [...document.querySelectorAll('.mc-lv-opt')]
      .filter(o => o.getAttribute('tabindex') === '0').length;
    return { focusable, tabbable: tabbable.length, wasSelected: selected.map(o => o.dataset.darg), after, stops };
  });
  ok(kb.focusable, 'a level takes keyboard focus', kb);
  ok(kb.tabbable === 1,
     'and the group is ONE tab stop, not three, as a radio group must be', kb.tabbable);
  ok(kb.after.length === 1 && kb.after[0] !== kb.wasSelected[0],
     'an arrow key moves the choice, which is what role=radio promises', kb);
  ok(kb.stops === 1, 'and the single tab stop follows the selection', kb.stops);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(x => setTimeout(x, 800));
    const opts = [...document.querySelectorAll('.mc-lv-opt')];
    const rows = [...document.querySelectorAll('.mc-act-row')];
    const fits = el => { const b = el.getBoundingClientRect(); return b.left >= -1 && b.right <= window.innerWidth + 1; };
    return {
      opts: opts.length && opts.every(fits),
      tappable: opts.every(o => !__under(o.getBoundingClientRect().height, 44)),
      rows: !rows.length || rows.every(fits),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(r.opts && r.tappable, 'the levels fit a phone and are big enough to tap', r);
  ok(r.rows, 'and so does the record', r);
  ok(!r.sideways, 'without pushing the page sideways', r);
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
  const bad = L.served.filter(s => s.status >= 500);
  ok(bad.length === 0, 'and the worker never fell over', bad.map(s => s.path));
}

await L.close();
outbound.restore();
if (report('the-setting-that-holds-it-back') > 0) process.exitCode = 1;
done();
