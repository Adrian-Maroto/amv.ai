/* TEACH AMV BY SHOWING IT - THE PAGE.

   Audit #34. From Skills, "Teach by showing": name the site, AMV's browser
   opens there in the panel, every tap and every thing typed is listed as a
   step (a secret as "(not recorded)"), and "Finish teaching" closes the
   browser and opens a review the person reads and changes before anything is
   saved. Saving makes an active skill that tells the engine to do those
   steps in AMV's browser on that site. Driven in a real page, with AMV's
   server answered by the shapes the Worker sends (teach-amv-by-showing-it in
   tests/worker drives the Worker itself). */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page } = app;
const shot = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 128; c.height = 90; const g = c.getContext('2d'); g.fillStyle = '#4a7'; g.fillRect(0, 0, 128, 90); return c.toDataURL('image/jpeg').split(',')[1]; });
const calls = [];
await page.route('https://teach-test.workers.dev/**', async (route) => {
  const req = route.request(); const path = new URL(req.url()).pathname; let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  calls.push({ path, body });
  const send = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (path === '/v1/browser/replay') return send({ ok: true, ran: body.steps.length, of: body.steps.length, results: body.steps.map((_, i) => ({ i, kind: body.steps[i].kind, ok: true })), url: body.url, shot });
  if (path === '/v1/browser/teach') return send({ ok: true, handle: 'h-1', url: body.url, at: 'crm.example.com/deals', shot, forMs: 600000 });
  if (path === '/v1/browser/takeover') {
    const a = body.act || {};
    if (a.kind === 'close') return send({ ok: true, closed: true });
    if (a.kind === 'click') return send({ ok: true, shot, step: { kind: 'click', tag: 'button', type: 'submit', label: 'Mark as won', at: 'crm.example.com/deals', find: { id: 'won', label: 'Mark as won' } } });
    if (a.kind === 'check') return send({ ok: true, check: { kind: 'check', text: a.text, shown: a.text === 'Deal won', at: 'crm.example.com/deals' } });
    if (a.kind === 'type' && a.text === 'Hunter2!') return send({ ok: true, shot, step: { kind: 'type', secret: true, tag: 'input', type: 'password', label: 'Password', at: 'crm.example.com/login' } });
    if (a.kind === 'type') return send({ ok: true, shot, step: { kind: 'type', text: a.text, tag: 'input', type: 'text', label: 'Note', at: 'crm.example.com/deals' } });
    return send({ ok: true, shot });
  }
  return send({}, 404);
});
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());
await page.evaluate(() => { saveStr('amv_browser_service', 'https://teach-test.workers.dev'); AMV_API.token = 'tok'; });

section('Skills offers it, and starting it opens AMV’s browser at the site');
{
  await page.evaluate(() => goSettings('skills'));
  await page.waitForSelector('#sk-teach', { timeout: 15000 });
  await page.click('#sk-teach');
  await page.fill('#sk-teach-url', 'crm.example.com/deals');
  await page.click('#sk-teach-start');
  await page.waitForSelector('.wlv-take', { timeout: 15000 });
  const t = calls.find(c => c.path === '/v1/browser/teach');
  ok(t && t.body.url === 'https://crm.example.com/deals', 'the site is sent, with https added', t && t.body);
  ok(await page.evaluate(() => /Show AMV the task/.test(document.getElementById('wlv-now').textContent)), 'and the panel says what to do', true);
  ok(await page.evaluate(() => S.tab !== 'settings'), 'with Settings out of the way', await page.evaluate(() => S.tab));
}

section('Each tap and each thing typed is a step; a secret is listed as not recorded');
{
  await page.waitForFunction(() => { const i = document.getElementById('wlv-img'); return i && !i.hidden && i.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
  await page.click('#wlv-img', { position: { x: 20, y: 20 } });
  await page.waitForFunction(() => document.querySelectorAll('#wlv-steps li').length === 1);
  await page.fill('#wlv-text', 'Signed the renewal');
  await page.click('[data-take="type"]');
  await page.waitForFunction(() => document.querySelectorAll('#wlv-steps li').length === 2);
  await page.fill('#wlv-text', 'Hunter2!');
  await page.click('[data-take="type"]');
  await page.waitForFunction(() => document.querySelectorAll('#wlv-steps li').length === 3);
  const steps = await page.evaluate(() => [...document.querySelectorAll('#wlv-steps li')].map(l => l.textContent));
  ok(/Click “Mark as won”/.test(steps[0]) && /Type “Signed the renewal” into “Note”/.test(steps[1]), 'the steps read as what was done', steps);
  ok(/not recorded/.test(steps[2]) && !/Hunter2/.test(steps.join(' ')), 'and the password is listed as not recorded, never shown', steps[2]);
}

section('A check is kept only when the page shows it now');
{
  await page.fill('#wlv-check', 'Order cancelled');
  await page.click('[data-take="check"]');
  await page.waitForFunction(() => /does not show that/.test(document.getElementById('wlv-now').textContent));
  ok(await page.evaluate(() => document.querySelectorAll('#wlv-steps li').length === 3), 'text the page does not show is not added, and it says so');
  await page.fill('#wlv-check', 'Deal won');
  await page.click('[data-take="check"]');
  await page.waitForFunction(() => document.querySelectorAll('#wlv-steps li').length === 4);
  const last = await page.evaluate(() => [...document.querySelectorAll('#wlv-steps li')].pop().textContent);
  ok(/Check the page shows “Deal won”/.test(last), 'text it does show becomes a step', last);
}

section('Finishing closes the browser and opens a review - nothing is saved yet');
{
  await page.click('[data-take="resume"]');
  await page.waitForSelector('#wlvt-steps', { timeout: 10000 });
  ok(calls.some(c => c.path === '/v1/browser/takeover' && c.body.act && c.body.act.kind === 'close'), 'the browser is closed rather than left for its ten minutes', true);
  const r = await page.evaluate(() => ({ name: document.getElementById('wlvt-name').value, steps: document.getElementById('wlvt-steps').value, saved: (load('amv_skills') || []).length }));
  ok(/crm\.example\.com/.test(r.name) && /Mark as won/.test(r.steps) && /not recorded/.test(r.steps), 'the draft holds the steps, named for the site', r);
  ok(r.saved === 0, 'and nothing is a skill until the person saves it', r.saved);
}

section('Saving makes an active skill that does it in AMV’s browser');
{
  await page.fill('#wlvt-name', 'Close a deal in the CRM');
  await page.fill('#wlvt-when', 'When I say a deal closed');
  await page.click('[data-wlvt="save"]');
  const s = await page.evaluate(() => { const k = (load('amv_skills') || []).slice(-1)[0] || {}; return { k, active: (load('amv_active_skills') || []).includes(k.id), ctx: _skillsContext() }; });
  ok(s.k.name === 'Close a deal in the CRM' && s.k.mode === 'auto' && s.k.taught && s.k.taught.site === 'crm.example.com', 'saved as the person named it, used when it applies', s.k);
  ok(/web automation tool on https:\/\/crm\.example\.com\/deals/.test(s.k.instr) && /never typing a password/.test(s.k.instr), 'it tells the engine to use AMV’s browser there, and never to type a password', s.k.instr && s.k.instr.slice(0, 200));
  ok(s.active && /Close a deal in the CRM/.test(s.ctx), 'it is switched on, and chat is told about it', s.active);
}

section('Run it now replays exactly what was recorded, asking for the secret for this run only');
{
  const k = await page.evaluate(() => (load('amv_skills') || []).slice(-1)[0]);
  ok(k.taught && k.taught.start === 'https://crm.example.com/deals' && k.taught.steps.length === 4, 'the recorded steps are kept with the skill', k.taught);
  ok(k.taught.steps[0].find && k.taught.steps[0].find.id === 'won' && k.taught.steps[3].kind === 'check', 'with how to find each thing, and the check', k.taught.steps);
  ok(!/Hunter2/.test(JSON.stringify(k)), 'and nothing secret is in it');
  await page.evaluate(() => goSettings('skills'));
  await page.waitForSelector('[data-skrun]', { timeout: 15000 });
  await page.click('[data-skrun]');
  await page.waitForSelector('[data-wrp-secret]', { timeout: 10000 });
  await page.fill('[data-wrp-secret]', 'Hunter2!');
  calls.length = 0;
  await page.click('[data-wrp="go"]');
  await page.waitForSelector('.wrp-steps', { timeout: 15000 });
  const r = calls.find(c => c.path === '/v1/browser/replay');
  ok(r && r.body.url === 'https://crm.example.com/deals' && r.body.steps.length === 4, 'the recorded steps are sent to be replayed where they began', r && r.body.url);
  ok(r && r.body.secrets && r.body.secrets['2'] === 'Hunter2!', 'with the secret typed for this run, against its step', r && Object.keys(r.body.secrets || {}));
  const shown = await page.evaluate(() => ({ h: document.getElementById('wrp-h').textContent, rows: [...document.querySelectorAll('.wrp-steps li')].map(l => l.className) }));
  ok(/every step checked/.test(shown.h) && shown.rows.length === 4 && shown.rows.every(c => c === 'ok'), 'and every step is shown as done and checked', shown);
  ok(await page.evaluate(() => !JSON.stringify(localStorage).includes('Hunter2')), 'the secret is kept nowhere on the device');
}

ok(app.errors.length === 0, 'no JavaScript errors', app.errors.slice(0, 3));
await app.close();
if (report('teach-amv-by-showing-it') > 0) process.exitCode = 1;
done();
