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
