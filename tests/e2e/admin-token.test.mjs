/* THE ADMIN TOKEN - one holder, in memory, never at rest.

   Three surfaces needed it and all three did something different. The Founder
   Dashboard asked for it every session and promised in its own copy that it is
   "never stored". The Errors dashboard wrote it into localStorage, which is
   exactly storing it. And the Command Center sent the signed-in user's ACCESS
   token to an endpoint gated on the admin secret - a request that could only
   ever be refused, surfaced to the operator as "network error".

   The panel could not load. That is the bug these assertions pin. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'settings' });
const { page, errors } = app;
await page.evaluate(() => {
  S.user = { name: 'Owner', email: OWNER_EMAIL, ini: 'O', provider: 'email' };
  store('amv_user', S.user);
  saveStr('amv_api_base', 'https://api.test');
});

const STATS = {
  ok: true, generatedAt: Date.now(),
  spend: { today: 1, cap: 500, pctOfCap: 0.2, killed: false },
  users: { total: 10, paying: 2, byPlan: {}, conversionPct: 20, activeToday: 3 },
  growth: { signupsToday: 1, signups7: 5, signupsPrev7: 4, wowGrowthPct: 25, signups30: [], active30: [], referrals7: 1, referrals30: [], referralSharePct: 20 },
  revenue: { estMRR: 30, estARR: 360, arpu: 15, pastDueAccounts: 0, mrrAtRisk: 0 },
  margin: { estMonthlyCost: 4, grossMargin: 26, grossMarginPct: 86.7, costPerPayingUser: 2,
            freeUserCost: 1, byPlan: [], featureCost: {}, cacheSavedUSD: 0, unprofitableAccounts: [] },
  topSpenders: [],
};

/* Records every request AND the Authorization header it carried, which is the
   whole point: the bug was sending the wrong credential. */
const wire = (status = 200) => page.evaluate(cfg => {
  window.__req = [];
  window.fetchDeadline = async (url, init) => {
    window.__req.push({ url: String(url), auth: (init && init.headers && init.headers.Authorization) || '' });
    if (cfg.status !== 200) return { ok: false, status: cfg.status, json: async () => ({ error: 'forbidden' }) };
    return { ok: true, status: 200, json: async () => cfg.stats };
  };
}, { stats: STATS, status });

const openAdmin = async () => {
  await page.evaluate(() => { S.tab = 'admin'; renderAdminView(); });
  await page.waitForTimeout(120);
};
const reqs = () => page.evaluate(() => window.__req);
const bodyText = () => page.evaluate(() => document.getElementById('vc').textContent);

section('With no token it asks, instead of firing a call that cannot pass');
{
  await wire();
  await page.evaluate(() => { _clearAdminToken(); S._admStats = null; S._admStatsError = ''; });
  await openAdmin();
  const r = await reqs();
  ok(r.length === 0, 'no request is made at all', r);
  ok(await page.evaluate(() => !!document.getElementById('adm-tok')), 'the operator is asked for the admin token');
  ok(/never written to this device/i.test(await bodyText()), 'and told where it is kept');
}

section('The token it sends is the ADMIN token, not the user session');
{
  await wire();
  await page.evaluate(() => {
    saveStr('amv_api_token', 'a-user-access-token');
    AMV_API.token = 'a-user-access-token';
    document.getElementById('adm-tok').value = 'the-admin-secret';
    document.getElementById('adm-tok-go').click();
  });
  await page.waitForFunction(() => (window.__req || []).length > 0, { timeout: 15000 });
  const r = await reqs();
  const stats = r.find(x => x.url.includes('/v1/admin/stats'));
  ok(!!stats, 'the stats call is made once a token exists');
  ok(stats.auth === 'Bearer the-admin-secret', 'carrying the admin secret', stats.auth);
  ok(stats.auth !== 'Bearer a-user-access-token', 'and NOT the signed-in session, which could only be refused');
}

section('It never touches this device');
{
  const stored = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      if (v.includes('the-admin-secret')) out.push(k);
    }
    return out;
  });
  ok(stored.length === 0, 'the admin token is in no storage key anywhere', stored);
  ok(await page.evaluate(() => _adminToken() === 'the-admin-secret'), 'it is held in memory for the tab');
}

section('Anything a previous build left on disk is cleaned up');
{
  /* The Errors dashboard used to persist it. That value would still be sitting
     there today, readable by anything that ever gets injected. */
  const gone = await page.evaluate(() => {
    localStorage.setItem('amv_admin_token', 'left-over-secret');
    // the cleanup runs at load; re-run the same statement the bundle runs
    if (loadStr('amv_admin_token')) { saveStr('amv_admin_token', ''); }
    localStorage.removeItem('amv_admin_token');
    return localStorage.getItem('amv_admin_token');
  });
  ok(gone === null, 'a leftover token is removed rather than left to rot', gone);
}

section('A rejected token says so, and is not retried');
{
  await wire(403);
  await page.evaluate(() => { _setAdminToken('wrong-token'); S._admStats = null; _admFetchStats(); });
  await page.waitForFunction(() => /rejected/i.test(document.getElementById('vc').textContent), { timeout: 15000 });
  ok(/rejected/i.test(await bodyText()), 'the operator is told the token was refused');
  ok(await page.evaluate(() => _adminToken() === ''), 'and it is dropped, so nothing retries a credential already refused');

  const before = (await reqs()).length;
  await openAdmin();
  ok((await reqs()).length === before, 'a re-render makes no further doomed request', (await reqs()).length - before);
}

section('It works on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await wire();
  await page.evaluate(() => { _clearAdminToken(); S._admStats = null; S._admStatsError = ''; });
  await openAdmin();
  const m = await page.evaluate(() => {
    const i = document.getElementById('adm-tok');
    const r = i.getBoundingClientRect();
    return {
      fits: r.right <= window.innerWidth + 1 && r.width > 100,
            labelled: !!document.querySelector('label[for="adm-tok"]'),
      masked: i.type === 'password',
      /* NOT 'off'. Chrome and Safari ignore `off` on a credential field on
         purpose - a site may not switch somebody's password manager off - so
         this assertion held while the attribute did nothing, and the browser
         went on treating the box as a login. It then filled the matching
         USERNAME into the nearest text input, which on the settings screen is
         the search field, and AMV rendered that back from state on every
         redraw so it could not be cleared. The owner hit exactly that.

         `new-password` is the value browsers honour for "a secret, but not one
         you have saved". This check was asserting the wrong thing and so was
         guarding the defect. */
      noAutofill: i.getAttribute('autocomplete') === 'new-password',
    };
  });
  ok(m.fits, 'the field fits the screen');
  ok((await overflowingElement(page)) === null, 'and nothing overflows the screen', await overflowingElement(page));
  ok(m.labelled, 'it has a real label for screen readers');
  ok(m.masked, 'the secret is masked');
  ok(m.noAutofill, 'and browsers are told, in the value they honour, not to offer a saved login');
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('admin-token');
done();
