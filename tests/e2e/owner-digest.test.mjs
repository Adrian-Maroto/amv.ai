/* THE DIGEST CARD on the Founder Dashboard.

   The digest exists to arrive without being asked, so the owner should not have
   to wait a week to find out whether it works or what it will say. This card
   shows the exact text that gets sent and can send it on demand - and because
   sending puts a message in someone's inbox, that is a separate, confirmed
   action rather than something a page load does. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

/* The Founder Dashboard is operator-only, and the operator is decided by
   email - so the test signs in as that account rather than trying to set an
   admin flag, which is exactly the gate a real operator passes through. */
const app = await bootApp({ tab: 'settings' });
const { page, errors } = app;
await page.evaluate(() => {
  S.user = { name: 'Owner', email: OWNER_EMAIL, ini: 'O', provider: 'email' };
  store('amv_user', S.user);
});

const STATS = {
  ok: true, generatedAt: Date.now(),
  spend: { today: 4.2, cap: 500, pctOfCap: 0.8, killed: false },
  users: { total: 40, paying: 6, byPlan: {}, conversionPct: 15, activeToday: 11 },
  growth: { signupsToday: 2, signups7: 14, signupsPrev7: 9, wowGrowthPct: 56, signups30: [], active30: [], referrals7: 4, referrals30: [], referralSharePct: 28.6 },
  revenue: { estMRR: 180, estARR: 2160, arpu: 30, pastDueAccounts: 0, mrrAtRisk: 0 },
  margin: { estMonthlyCost: 22, grossMargin: 158, grossMarginPct: 87.8, costPerPayingUser: 3.667,
            freeUserCost: 4.1, byPlan: [], featureCost: {}, cacheSavedUSD: 3.2, unprofitableAccounts: [] },
  topSpenders: [],
};
const DIGEST = {
  ok: true, preview: true, week: '2026-07-27',
  subject: 'AMV weekly: 14 signups, $180 MRR',
  snapshot: {}, previous: null, flags: [],
  text: 'AMV weekly - week of 2026-07-27\n\nSignups this week: 14\nMRR: $180.00\n\nNothing needs a decision this week.',
};

/* Stand in for the Worker. Records every admin call so we can prove which ones
   a page load makes - and, more importantly, which ones it does not. */
const wire = (opts = {}) => page.evaluate(cfg => {
  window.__admCalls = [];
  window.__confirmAnswer = cfg.confirmAnswer;
  /* AMV asks in its own dialog now, so the stub answers nothing. __answerConfirm
     presses the real button and records the real question. */
  window.__answerConfirm(window.__confirmAnswer);
  saveStr('amv_api_base', 'https://amv-stub.workers.dev');
  window.fetchDeadline = async (url) => {
    const u = String(url);
    window.__admCalls.push(u);
    if (u.includes('/v1/admin/stats')) return { ok: true, status: 200, json: async () => cfg.stats };
    if (u.includes('/admin/digest?send=1')) return { ok: true, status: 200, json: async () => (cfg.sendFails ? { ok: false, sent: false, reason: 'no OWNER_EMAIL' } : { ok: true, sent: true, week: '2026-07-27' }) };
    if (u.includes('/admin/digest')) {
      if (cfg.previewFails) return { ok: false, status: 503, json: async () => ({ error: 'metrics unavailable' }) };
      return { ok: true, status: 200, json: async () => cfg.digest };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}, { stats: STATS, digest: DIGEST, confirmAnswer: opts.confirmAnswer !== false,
     sendFails: !!opts.sendFails, previewFails: !!opts.previewFails });

async function openDashboard() {
  await page.evaluate(() => { S.settingsPane = 'dashboard'; renderSetPane(); });
  await page.waitForSelector('#fd-token', { timeout: 15000 });
  await page.evaluate(() => { document.getElementById('fd-token').value = 'admin-secret'; document.getElementById('fd-load').click(); });
  await page.waitForSelector('#fd-digest-preview', { timeout: 15000 });
}
const out = () => page.evaluate(() => document.getElementById('fd-digest-out').textContent);
const calls = () => page.evaluate(() => window.__admCalls);

section('The card is on the dashboard, and loading it sends no mail');
{
  await wire();
  await openDashboard();
  const c = await calls();
  ok(c.some(u => u.includes('/v1/admin/stats')), 'the dashboard loaded its stats', c.length);
  ok(!c.some(u => u.includes('send=1')), 'and nothing was emailed by opening the page', c);
  ok((await out()) === '', 'the output area starts empty rather than pre-filled with a guess');
}

section('Preview shows the text that would actually be sent');
{
  // Self-contained rather than leaning on the previous section's state, so a
  // failure here is about the preview and nothing else.
  await wire();
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-preview').click());
  await page.waitForFunction(() => /MRR/.test(document.getElementById('fd-digest-out').textContent), { timeout: 15000 });
  const t = await out();
  ok(t.includes('AMV weekly: 14 signups'), 'the subject line is shown', t.split('\n')[0]);
  ok(t.includes('Signups this week: 14'), 'along with the body, verbatim');
  ok(!(await calls()).some(u => u.includes('send=1')), 'and previewing still sends nothing');
}

section('Sending is confirmed first, because it reaches a person');
{
  await wire({ confirmAnswer: false });
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-send').click());
  await page.waitForTimeout(200);
  const v = await page.evaluate(() => ({ asked: window.__lastConfirm, calls: window.__admCalls }));
  ok(/digest to the owner/i.test(v.asked || ''), 'it asks first', v.asked);
  ok(!v.calls.some(u => u.includes('send=1')), 'and declining sends nothing at all', v.calls);
}

section('Confirming sends it, once, and says so');
{
  await wire();
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-send').click());
  await page.waitForFunction(() => /Sent to the owner/.test(document.getElementById('fd-digest-out').textContent), { timeout: 15000 });
  const c = await calls();
  ok(c.filter(u => u.includes('send=1')).length === 1, 'exactly one send request', c.filter(u => u.includes('send=1')).length);
  ok(/Sent to the owner/.test(await out()), 'and the result is stated');
}

section('A refusal from the server is reported as a refusal');
{
  await wire({ sendFails: true });
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-send').click());
  await page.waitForFunction(() => /Not sent/.test(document.getElementById('fd-digest-out').textContent), { timeout: 15000 });
  const t = await out();
  ok(/Not sent/.test(t), 'it does not claim success', t);
  ok(/OWNER_EMAIL/.test(t), 'and passes on the reason, which is the thing to fix', t);
}

section('A failed preview says so instead of showing an empty box');
{
  await wire({ previewFails: true });
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-preview').click());
  /* Read the text in the SAME evaluate that observes it. Reading twice let the
     pane's delayed stats reload land in between and clear the box - which was a
     real defect in the card, now fixed, and a race this assertion should not
     depend on either way. */
  const shown = await page.waitForFunction(() => {
    const t = document.getElementById('fd-digest-out').textContent;
    return /Could not build/.test(t) ? t : null;
  }, { timeout: 15000 }).then(h => h.jsonValue());
  ok(/metrics unavailable/.test(shown), 'with the reason from the server', shown);
}

section('It reads on a phone');
{
  /* Size the screen BEFORE opening the pane. A resize re-renders settings, so
     opening at desktop width and then shrinking would be testing a card that
     had already been rebuilt underneath - and a phone user arrives at 390px
     anyway. */
  await page.setViewportSize({ width: 390, height: 844 });
  await wire();
  await openDashboard();
  await page.evaluate(() => document.getElementById('fd-digest-preview').click());
  await page.waitForFunction(() => /MRR/.test(document.getElementById('fd-digest-out').textContent), { timeout: 15000 });
  const m = await page.evaluate(() => ({
        live: document.getElementById('fd-digest-out').getAttribute('aria-live'),
  }));
  ok((await overflowingElement(page)) === null, 'nothing overflows the screen with a long digest on it', await overflowingElement(page));
  ok(m.live === 'polite', 'and the result is announced, not only shown');
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('owner-digest-ui');
done();
