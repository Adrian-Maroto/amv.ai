/* AMV INSTALLS, AND TAKES WHAT YOU SHARE INTO IT.

   Checked in a real browser:
   - the manifest makes AMV a share target and gives its icon a menu, and
     every shortcut opens a screen that exists;
   - something shared into AMV opens a new chat with it in the box - and is
     NOT sent - with the address cleaned so a reload does not do it again;
   - a shared link that is also in the text arrives once, not twice;
   - the icon's New chat opens an empty new chat;
   - Help says how to install on THIS device: an install button where the
     browser offers one, the Share steps on an iPhone, "you are using the app"
     inside it, and the honest answer on Firefox;
   - an iPhone is told once, on its second visit, and never after dismissing;
   - the Google Play proof file is published only with a real fingerprint. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { assetLinks } from '../../apps/android/assetlinks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));

section('The manifest makes AMV a share target, and its icon has a menu');
{
  const st = manifest.share_target || {};
  ok(st.action === '/' && st.method === 'GET' && st.params && st.params.text === 'text' && st.params.url === 'url' && st.params.title === 'title',
     'shared text, links and titles come to the app', st);
  const urls = (manifest.shortcuts || []).map(s => s.url);
  ok(urls.includes('/?new=1') && urls.includes('/#/crew') && urls.includes('/#/integrations'), 'New chat, Crew and Connectors', urls);
  ok(manifest.id === '/' && (manifest.icons || []).some(i => i.purpose === 'maskable'), 'with a stable id and a maskable icon');
}

const SHARED = '?title=' + encodeURIComponent('A great read') + '&text=' + encodeURIComponent('Look at this https://example.com/post')
  + '&url=' + encodeURIComponent('https://example.com/post');
const app = await bootApp({ tab: 'chat', query: SHARED });
const { page, errors } = app;

section('Shared into AMV: a new chat with it in the box, and nothing sent');
{
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    box: document.getElementById('mta').value,
    sent: (getMsgs() || []).filter(m => m.r === 'u').length,
    search: location.search,
  }));
  ok(/A great read/.test(r.box) && /Look at this https:\/\/example\.com\/post/.test(r.box), 'the title and the text are in the box', r.box);
  ok((r.box.match(/example\.com\/post/g) || []).length === 1, 'the link is there once, not twice', r.box);
  ok(r.sent === 0, 'and nothing was sent - a share is material, not an instruction', r.sent);
  ok(!/text=|url=|title=/.test(r.search), 'the address no longer carries it', r.search);
  const before = await page.evaluate(() => S.convs.length);
  await page.evaluate(() => { _applyLaunchIntent(); });
  ok((await page.evaluate(() => S.convs.length)) === before, 'and it is applied once - running it again opens nothing');
}

section('The icon’s New chat opens an empty new chat');
{
  const r = await page.evaluate(() => {
    /* The share above is an unsent draft, and an empty chat deliberately
       offers the latest unsent draft back (so a reload does not lose typing).
       Cleared, so this case is about the icon and nothing else. */
    (load('amv_draft_ix') || []).forEach(k => saveStr(k, '')); store('amv_draft_ix', []);
    document.getElementById('mta').value = '';
    const before = S.convs.length;
    sessionStorage.setItem('amv_launch', JSON.stringify(_launchIntent('?new=1')));
    _applyLaunchIntent();
    return { made: S.convs.length - before, box: document.getElementById('mta').value };
  });
  ok(r.made === 1 && r.box === '', 'one new chat, nothing in the box', r);
  ok(await page.evaluate(() => _launchIntent('?invite=abc') === null), 'and an unrelated address is not mistaken for a launch');
}

const card = () => page.evaluate(() => { setTab('help'); const c = document.getElementById('apps-card'); return c ? c.textContent.replace(/\s+/g, ' ') : ''; });
const asDevice = (ua, extra) => page.evaluate(([ua, extra]) => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => (extra && extra.touch) || 0 });
  window.matchMedia = ((orig) => (q) => (extra && extra.standalone && /standalone/.test(q)) ? { matches: true, addListener() {}, removeListener() {} } : orig(q))(window.__mm || (window.__mm = window.matchMedia.bind(window)));
  window._amvInstallEvt = (extra && extra.prompt) ? window.__fakePrompt : null;
}, [ua, extra || null]);

section('Help says how to install on THIS device');
{
  await page.evaluate(() => {
    window.__prompted = 0;
    window.__fakePrompt = { prompt() { window.__prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  });
  await asDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36', { prompt: true });
  ok(/Install AMV/.test(await card()), 'where the browser offers to install: a button');
  await page.click('#apps-install');
  ok((await page.evaluate(() => window.__prompted)) === 1, 'and the button asks the browser to install it');

  await asDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
  ok(/Tap Share, then Add to Home Screen/.test(await card()), 'an iPhone, which has no prompt: the two taps');
  await asDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', { touch: 5 });
  ok(/Tap Share/.test(await card()), 'an iPad, which says it is a Mac, is still treated as one');
  await asDevice('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0');
  ok(/Firefox does not install web apps/.test(await card()), 'Firefox: the honest answer');
  await asDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', { standalone: true });
  ok(/You are using the AMV app/.test(await card()), 'inside the installed app: it says so');
  ok(!/Google Play|Microsoft Store/.test(await card()), 'and no store link is shown while there is no listing');
}

section('An iPhone is told once, on its second visit');
{
  await asDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
  const r = await page.evaluate(() => {
    saveStr('amv_install_dismissed', ''); saveStr('amv_visits', '0');
    document.getElementById('amv-install-chip')?.remove();
    _iosInstallHint(); const first = !!document.getElementById('amv-install-chip');
    _iosInstallHint(); const second = !!document.getElementById('amv-install-chip');
    const text = (document.getElementById('amv-install-chip') || {}).textContent || '';
    document.getElementById('ic-no')?.click();
    _iosInstallHint(); const after = !!document.getElementById('amv-install-chip');
    return { first, second, text, after };
  });
  ok(!r.first, 'not on the first visit', r);
  ok(r.second && /Add to Home Screen/.test(r.text), 'on the second, with the two taps', r.text);
  ok(!r.after, 'and never again once dismissed', r);
}

section('The Google Play proof file is published only with a real fingerprint');
{
  ok(assetLinks({ packageId: 'homes.amv.app', sha256: [] }) === null, 'no fingerprint: nothing published');
  let threw = false;
  try { assetLinks({ packageId: 'homes.amv.app', sha256: ['not-a-print'] }); } catch (e) { threw = true; }
  ok(threw, 'a malformed fingerprint stops the build rather than publishing a file that verifies nothing');
  const fp = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
  const out = JSON.parse(assetLinks({ packageId: 'homes.amv.app', sha256: [fp] }));
  ok(out[0].target.package_name === 'homes.amv.app' && out[0].target.sha256_cert_fingerprints[0] === fp.toUpperCase()
     && out[0].relation[0] === 'delegate_permission/common.handle_all_urls', 'a real one: the file Android reads', out[0]);
  const cfg = JSON.parse(readFileSync(join(ROOT, 'apps', 'android', 'config.json'), 'utf8'));
  ok(cfg.packageId === JSON.parse(readFileSync(join(ROOT, 'apps', 'android', 'twa-manifest.json'), 'utf8')).packageId,
     'and the Play package name is the same in both places');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('amv-installs-and-takes-what-you-share') > 0) process.exitCode = 1;
done();
