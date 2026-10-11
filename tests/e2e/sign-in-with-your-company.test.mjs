/* SIGN IN WITH YOUR COMPANY - IN A REAL BROWSER, BOTH WAYS.

   The page's half of company sign-in, with AMV's server and the company's
   identity provider stood in for at the network (page.route), so the app's
   own request code, its address-bar handling at boot and its sign-in all run
   for real:

   - "Sign in with your company" asks for the work address first, and says
     plainly when that company has not set it up;
   - set up, it sends the browser to the company's provider;
   - coming back with a code finishes the sign-in through AMV's server, signs
     the person in, and takes the code out of the address bar;
   - coming back refused, or with a sign-in the server would not accept, signs
     nobody in and says why;
   - a password sign-in at a domain that requires its company is taken to the
     company instead;
   - the owner's settings load on demand and walk through set, prove, require. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const API = 'https://api.example.workers.dev';
const IDP = 'https://login.acme-corp.example';
const app = await bootApp({ tab: 'chat', user: null, apiBase: API });
const { page, errors } = app;
const appUrl = page.url().split('?')[0];

const seen = [];
let finishAnswer = null, loginAnswer = null, ssoState = null;
const jwt = (o) => ['e30', Buffer.from(JSON.stringify(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, o))).toString('base64url'), 'sig'].join('.');
await page.route(API + '/**', async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  seen.push({ path, body });
  const reply = (status, d) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(d) });
  if (path === '/auth/sso/start') {
    if (/@acme-corp\.com$/.test(body.email)) return reply(200, { ok: true, sso: true, team: 'Acme', url: IDP + '/authorize?client_id=c&state=s_' + 'a'.repeat(43) });
    return reply(200, { ok: true, sso: false });
  }
  if (path === '/auth/sso/finish') return reply(finishAnswer.status, finishAnswer.body);
  if (path === '/auth/login' && loginAnswer) return reply(loginAnswer.status, loginAnswer.body);
  if (path === '/team/sso') {
    if (body.action === 'set') ssoState = { domain: body.domain, issuer: body.issuer, clientId: body.clientId, verified: false, required: false,
      record: { name: '_amv-verify.' + body.domain, value: 'amv-verify=0123456789abcdef0123456789abcdef' } };
    if (body.action === 'verify') { ssoState.verified = true; return reply(200, { ok: true, verified: true, sso: ssoState }); }
    if (body.action === 'require') ssoState.required = body.on === true;
    return reply(200, { ok: true, sso: ssoState, redirectUri: appUrl });
  }
  return reply(200, { ok: true });
});
await page.route(IDP + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Acme sign-in</title><p>Acme</p>' }));

const authErr = () => page.evaluate(() => (document.getElementById('auth-err') || {}).textContent || '');
const openLogin = () => page.evaluate(() => { openAuth('login'); });

section('It asks for the work address, and says when a company has not set it up');
{
  await openLogin();
  await page.click('#auth-sso');
  await page.waitForFunction(() => /work email/.test((document.getElementById('auth-err') || {}).textContent || ''));
  ok(true, 'no address: it asks for one');
  await page.fill('#a-email', 'pat@nocompany.com');
  await page.click('#auth-sso');
  await page.waitForFunction(() => /has not set up sign-in/.test((document.getElementById('auth-err') || {}).textContent || ''));
  ok(seen.some(x => x.path === '/auth/sso/start' && x.body.email === 'pat@nocompany.com'), 'it asked AMV’s server about that address');
  ok(page.url().startsWith(appUrl), 'and stayed here', page.url());
}

section('Coming back with a sign-in the server will not accept: nobody is signed in');
{
  finishAnswer = { status: 401, body: { error: 'Your company’s system sent a sign-in AMV could not verify, so you were not signed in.', code: 'sso_bad_signature' } };
  await page.goto(appUrl + '?code=bad-code&state=s_' + 'b'.repeat(43));
  await page.waitForFunction(() => /could not verify/.test((document.getElementById('auth-err') || {}).textContent || ''), null, { timeout: 15000 });
  const st = await page.evaluate(() => ({ user: S.user && S.user.email, search: location.search }));
  ok(!st.user, 'not signed in', st);
  ok(st.search === '', 'and the code is out of the address bar', st.search);
  const fin = seen.filter(x => x.path === '/auth/sso/finish').pop();
  ok(fin && fin.body.code === 'bad-code' && fin.body.state === 's_' + 'b'.repeat(43), 'the code and state went to AMV’s server to check', fin);
}

section('Cancelled at the company: nothing is sent, and it says so');
{
  const n = seen.length;
  await page.goto(appUrl + '?error=access_denied&state=s_' + 'c'.repeat(43));
  await page.waitForFunction(() => /cancelled/.test(document.body.innerText), null, { timeout: 15000 });
  ok(!seen.slice(n).some(x => x.path === '/auth/sso/finish'), 'no finish was asked for');
}

section('Set up: the browser goes to the company’s own sign-in');
{
  await openLogin();
  await page.fill('#a-email', 'ana@acme-corp.com');
  await Promise.all([page.waitForURL(IDP + '/**', { timeout: 15000 }), page.click('#auth-sso')]);
  ok(page.url().startsWith(IDP + '/authorize'), 'at the company’s provider', page.url());
}

section('Back with a good code: signed in, and the code is gone from the address bar');
{
  finishAnswer = { status: 200, body: { token: jwt({ email: 'ana@acme-corp.com', typ: 'access' }), refreshToken: jwt({ typ: 'refresh' }), email: 'ana@acme-corp.com', name: 'Ana Ruiz', team: 'Acme' } };
  await page.goto(appUrl + '?code=good-code&state=s_' + 'a'.repeat(43));
  await page.waitForFunction(() => S.user && S.user.email === 'ana@acme-corp.com', null, { timeout: 15000 });
  const st = await page.evaluate(() => ({ name: S.user.name, provider: S.user.provider, search: location.search, live: AMV_API.hasSession }));
  ok(st.name === 'Ana Ruiz' && st.provider === 'sso', 'signed in as the person the company vouched for', st);
  ok(st.search === '' && st.live, 'with a session, and nothing left in the address bar', st);
}

section('A password at a domain that requires its company is taken to the company');
{
  await page.evaluate(() => { S.user = null; try { AMV_API.token = ''; } catch (e) {} });
  loginAnswer = { status: 403, body: { error: 'Your company signs in to AMV through its own system.', code: 'sso_required', domain: 'acme-corp.com' } };
  await openLogin();
  await page.fill('#a-email', 'leo@acme-corp.com');
  await page.fill('#a-pass', 'A-real-Passw0rd!');
  await Promise.all([page.waitForURL(IDP + '/**', { timeout: 15000 }), page.click('#auth-submit')]);
  ok(page.url().startsWith(IDP), 'sent to the company’s provider rather than refused', page.url());
  ok(seen.some(x => x.path === '/auth/sso/start' && x.body.email === 'leo@acme-corp.com'), 'for the address they typed');
  await page.goto(appUrl);
  await page.waitForTimeout(600);
}

section('The owner’s settings load on demand: set, prove, require');
{
  const r = await page.evaluate(async () => {
    const host = document.createElement('div'); host.id = 'sso-host'; host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow:auto;padding:16px;background:var(--bg)'; host.innerHTML = _teamSsoHTML(true); document.body.appendChild(host);
    const loaded = await _teamSsoLoad(host);
    return { fetched: typeof window._teamSsoStart === 'function', text: host.innerText };
  });
  ok(r.fetched && /redirect address/.test(r.text) && r.text.includes(appUrl), 'team-sso.js was fetched and the form names the redirect address', r.text.slice(0, 200));
  await page.fill('#sso-domain', 'acme-corp.com');
  await page.fill('#sso-issuer', IDP);
  await page.fill('#sso-client', 'client-1');
  await page.fill('#sso-secret', 'secret-1');
  await page.click('#sso-save');
  await page.waitForSelector('#sso-verify');
  const rec = await page.evaluate(() => document.getElementById('sso-host').innerText);
  ok(/_amv-verify\.acme-corp\.com/.test(rec) && /amv-verify=0123/.test(rec), 'it shows the DNS record to add', rec.slice(0, 300));
  const set = seen.filter(x => x.path === '/team/sso' && x.body.action === 'set').pop();
  ok(set.body.clientSecret === 'secret-1' && set.body.domain === 'acme-corp.com', 'what was typed was sent', set.body);
  await page.click('#sso-verify');
  await page.waitForSelector('#sso-require');
  await page.click('#sso-require');
  await page.waitForTimeout(400);
  const req = seen.filter(x => x.path === '/team/sso' && x.body.action === 'require').pop();
  ok(req && req.body.on === true, 'requiring it is one tick, sent as such', req);
  const on = await page.evaluate(() => document.getElementById('sso-require').checked);
  ok(on, 'and the box shows what the server now says');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('sign-in-with-your-company') > 0) process.exitCode = 1;
done();
