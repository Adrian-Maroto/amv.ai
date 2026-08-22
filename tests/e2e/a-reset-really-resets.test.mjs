/* WHAT A RESET LEAVES BEHIND.

   Resetting a tool used to be written as a list of fields to clear, and that
   list drifted the way such lists always do: a field added later was simply not
   on it, and nothing anywhere said so. Two real defects came out of that gap,
   both of them reaching a public URL.

     - `deploySlug` survived a NEW SESSION, so building a different app and
       publishing it replaced the previous app at its own address.
     - `lastHTML` survived a SIGN-OUT. _devDeploy falls back to it when the
       project is empty, so the next person to sign in on that browser could
       press Deploy on a blank screen and publish the PREVIOUS ACCOUNT'S work -
       to the previous account's slug, overwriting their site. The wipe function
       exists to prevent exactly that and did not know about the field.

   So this checks the rule and not the instances: every field ever assigned on
   the three state objects must be either in the declared defaults or in an
   explicit keep-list. A field added tomorrow fails this until somebody decides
   which it is, which is the whole point - naming the two leaks above and
   stopping there would leave the next one to be found in production. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort()
  .map(f => readFileSync(join(ROOT, 'src/app', f), 'utf8')).join('\n');

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('No field can survive a reset without somebody deciding it should');
{
  const decl = await page.evaluate(() => ({ defaults: window._TOOL_DEFAULTS, keep: window._TOOL_KEEP }));
  ok(decl.defaults && decl.keep, 'the defaults and the keep-list are declared');

  for (const [kind, obj] of [['dev', '_DEV'], ['lab', '_LAB'], ['studio', '_STUDIO']]) {
    const re = new RegExp('\\b' + obj + '\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=(?!=)', 'g');
    const assigned = [...new Set([...SRC.matchAll(re)].map(m => m[1]))];
    const known = new Set([...Object.keys(decl.defaults[kind] || {}), ...(decl.keep[kind] || [])]);
    const orphans = assigned.filter(f => !known.has(f));
    ok(assigned.length > 0, `${obj} has fields to check`, assigned.length);
    ok(orphans.length === 0,
       `every ${obj} field is either reset or deliberately kept`,
       orphans.length ? orphans.join(', ') + ' - add to _TOOL_DEFAULTS or _TOOL_KEEP' : '');
  }
}

section('Nothing of one account is left on S for the next one');
{
  /* The same enumeration, applied to the object that holds most user content.
     It caught two things nobody had thought about: _entVerified, the SERVER'S
     confirmation of a plan, which outlived the account it belonged to so that
     verifiedPlan() answered "ultra" for the next person to sign in; and the
     owner's revenue and payout totals sitting in memory afterwards. */
  const keep = await page.evaluate(() => window._S_SIGNOUT_KEEP);
  ok(Array.isArray(keep) && keep.length > 0, 'the survivor list is declared', keep && keep.length);

  const wipeBody = (SRC.match(/function _wipeAccountState\(\)\{[\s\S]*?\n\}/) || [''])[0];
  const cleared = new Set([...wipeBody.matchAll(/\bS\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map(m => m[1]));
  const re = /(?<![A-Za-z0-9_.])S\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g;
  const assigned = [...new Set([...SRC.matchAll(re)].map(m => m[1]))];
  const unclassified = assigned.filter(f => !cleared.has(f) && !keep.includes(f));
  ok(assigned.length > 20, 'there are S fields to check', assigned.length);
  ok(unclassified.length === 0,
     'every S field is either cleared on sign-out or listed as safe to keep',
     unclassified.join(', ') + (unclassified.length ? ' - clear it in _wipeAccountState or add it to _S_SIGNOUT_KEEP' : ''));

  /* And the one that mattered, driven rather than read. */
  const ent = await page.evaluate(async () => {
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    S.user = { name: 'Alice', email: 'alice@corp.com', ini: 'A' };
    saveStr('amv_plan', 'ultra');
    S._entVerified = { plan: 'ultra', at: Date.now() };
    S._admFinance = { revenue: 41234.5 };
    const asAlice = verifiedPlan();
    _wipeAccountState();
    S.user = { name: 'Bob', email: 'bob@other.com', ini: 'B' };
    saveStr('amv_plan', 'free');
    return { asAlice, asBob: verifiedPlan(), adminMoneyLeft: S._admFinance };
  });
  ok(ent.asAlice === 'ultra', 'a confirmed plan is honoured while that account is signed in', ent.asAlice);
  ok(ent.asBob === 'free',
     'and is NOT honoured for whoever signs in next on the same browser', ent.asBob);
  ok(!ent.adminMoneyLeft, "and the owner's totals do not sit there afterwards", ent.adminMoneyLeft);
}

section('Signing out does not hand the next account your Google connection');
{
  /* Most stored data is namespaced per account, so it cannot cross. _GLOBAL_KEYS
     is the deliberate exception for things belonging to the DEVICE - and several
     of its entries belong to a PERSON. Ordinary sign-out left all of them.

     Alice connects Google, signs out with the button in the profile menu, Bob
     signs in on the same browser, and Bob had her Google ACCESS TOKEN - the key
     AMV reads to reach Gmail, Calendar and Drive, and the same key the
     Integrations screen reads to decide Google is connected. Also the owner flag
     and her credit balance.

     The list existed in eraseDeviceData, which even calls these keys "personal to
     whoever was signed in" - but that path needs "Sign out AND ERASE", and the
     ordinary button is the one people press. */
  const lists = await page.evaluate(() => ({
    clear: window._SIGNOUT_CLEAR_GLOBAL, device: window._DEVICE_GLOBAL_KEYS,
  }));
  ok(Array.isArray(lists.clear) && lists.clear.length > 0, 'the personal-key list is declared', lists.clear && lists.clear.length);

  /* Every unscoped key must be classified as one or the other. A new global key
     added later fails here until somebody decides which it is - which is the
     only reason this was found, since nobody had a list of what leaks. */
  /* Only real key names. The first version matched any quoted lowercase word,
     and the match ran past the Set into _scopeKey below it, so the string
     'guest' was reported as an unclassified storage key. */
  const globals = (SRC.match(/const _GLOBAL_KEYS = new Set\(\[([\s\S]*?)\]\);/) || [])[1] || '';
  const names = [...new Set([...globals.matchAll(/'(amv_[a-z_]+)'/g)].map(m => m[1]))];
  ok(names.length > 10, 'the global key list was found', names.length);
  const unclassified = names.filter(k => !lists.clear.includes(k) && !lists.device.includes(k));
  ok(unclassified.length === 0,
     'every unscoped key is either cleared on sign-out or declared a device setting',
     unclassified.join(', ') + (unclassified.length ? ' - add to _SIGNOUT_CLEAR_GLOBAL or _DEVICE_GLOBAL_KEYS' : ''));

  const out = await page.evaluate(async () => {
    S.user = { name: 'Alice', email: 'alice@corp.com', ini: 'A' };
    localStorage.setItem('amv_user', JSON.stringify(S.user));
    saveStr('amv_gtoken', 'ya29.ALICE-PRIVATE-TOKEN');
    saveStr('amv_gtoken_exp', String(Date.now() + 3600e3));
    saveStr('amv_owner', '1');
    saveStr('amv_credits', '250');
    saveStr('amv_theme', 'dark');
    const alice = { token: loadStr('amv_gtoken'), owner: loadStr('amv_owner'), credits: loadStr('amv_credits') };
    signOut();
    await new Promise(s => setTimeout(s, 250));
    S.user = { name: 'Bob', email: 'bob@other.com', ini: 'B' };
    localStorage.setItem('amv_user', JSON.stringify(S.user));
    return { alice, bob: { token: loadStr('amv_gtoken'), owner: loadStr('amv_owner'),
                           credits: loadStr('amv_credits'), theme: loadStr('amv_theme') } };
  });
  ok(out.alice.token.length > 0, 'Alice really had a Google token connected', out.alice.token.slice(0, 12));
  ok(out.bob.token === '', 'and the next account does not get it', out.bob.token.slice(0, 24));
  ok(out.bob.owner === '', 'nor the owner flag', out.bob.owner);
  ok(out.bob.credits === '', 'nor the credit balance', out.bob.credits);
  ok(out.bob.theme === 'dark',
     'while the device\'s own settings are left alone, which is the point of the split', out.bob.theme);
}

section('A new session cannot publish the work the last one made');
{
  const out = await page.evaluate(async () => {
    S.user = { name: 'T', email: 't@amv.dev', ini: 'T' };
    saveStr('amv_plan', 'ultra');
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    const published = [];
    window.fetch = async (u, o) => {
      if (String(u).includes('/deploy')) {
        let b = {}; try { b = JSON.parse(o.body); } catch (e) {}
        published.push(String(b.html || '').slice(0, 50));
        return { ok: true, status: 200, json: async () => ({ url: 'https://amv.site/s', slug: 's' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('index.html', '<h1>THE FIRST APP</h1>', 'html');
    _DEV.lastHTML = '<h1>THE FIRST APP</h1>';
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    await _devDeploy();
    await new Promise(s => setTimeout(s, 250));

    try { _sessNew('dev'); } catch (e) {}
    _resetToolState('dev');
    const left = { lastHTML: _DEV.lastHTML || '', slug: _DEV.deploySlug || '' };
    renderCodeView();
    await new Promise(s => setTimeout(s, 250));
    await _devDeploy();
    await new Promise(s => setTimeout(s, 300));
    return { left, published };
  });
  ok(out.left.lastHTML === '', 'the built page does not survive the reset', out.left.lastHTML.slice(0, 40));
  ok(out.left.slug === '', 'and neither does the address it was published to', out.left.slug);
  ok(out.published.length === 1,
     'so pressing Deploy on the empty screen publishes nothing at all',
     out.published.join(' | '));
}

section('Signing out leaves nothing of yours for the next account');
{
  const out = await page.evaluate(async () => {
    const published = [];
    window.fetch = async (u, o) => {
      if (String(u).includes('/deploy')) {
        let b = {}; try { b = JSON.parse(o.body); } catch (e) {}
        published.push(String(b.html || '').slice(0, 50));
        return { ok: true, status: 200, json: async () => ({ url: 'https://amv.site/s', slug: 's' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    S.user = { name: 'Alice', email: 'alice@corp.com', ini: 'A' };
    saveStr('amv_plan', 'ultra');
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('index.html', '<h1>ALICE PRIVATE</h1>', 'html');
    _DEV.lastHTML = '<h1>ALICE PRIVATE</h1>';
    _LAB.code = 'alice_secret_key = "x"';
    setTab('dev');
    await new Promise(s => setTimeout(s, 350));
    await _devDeploy();
    await new Promise(s => setTimeout(s, 250));

    _wipeAccountState();
    const left = { devHTML: _DEV.lastHTML || '', slug: _DEV.deploySlug || '',
                   labCode: _LAB.code || '', devProject: Object.keys(_DEV.project || {}).length };

    S.user = { name: 'Bob', email: 'bob@other.com', ini: 'B' };
    saveStr('amv_plan', 'ultra');
    setTab('dev'); renderCodeView();
    await new Promise(s => setTimeout(s, 250));
    await _devDeploy();
    await new Promise(s => setTimeout(s, 300));
    return { left, published };
  });
  ok(out.left.devHTML === '', "the last account's built page is gone", out.left.devHTML.slice(0, 40));
  ok(out.left.labCode === '', 'and so is whatever was in Lab', out.left.labCode.slice(0, 40));
  ok(out.left.slug === '', 'and the address they published to', out.left.slug);
  ok(!out.published.some((h, i) => i > 0 && h.includes('ALICE')),
     'so the next account cannot publish it', out.published.join(' | '));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
await app.close();
if (report('a-reset-really-resets') > 0) process.exitCode = 1;
done();
