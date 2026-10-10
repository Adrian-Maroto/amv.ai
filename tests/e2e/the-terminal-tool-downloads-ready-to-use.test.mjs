/* THE TERMINAL TOOL DOWNLOADS READY TO USE.

   Settings -> API keys hands over amv-cli.mjs (tests/worker/amv-from-a-terminal
   drives the tool itself). This checks the hand-over: the file saved is the
   one the site serves with exactly one change - this deployment's address in
   place of the placeholder - and a copy of AMV with no server refuses rather
   than handing over a tool with nowhere to send questions. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVED = readFileSync(join(ROOT, 'amv-cli.mjs'), 'utf8');

const app = await bootApp({ tab: 'chat', user: { name: 'Dev', email: 'dev@example.com', ini: 'D' }, viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors } = app;

await page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  window.__base = 'https://amv-api.example.workers.dev';
  window.apiBase = () => window.__base;
  goSettings('api');
});
await page.waitForSelector('#ak-cli');

section('The pane says how to use it, key in the environment');
{
  const t = await page.evaluate(() => document.querySelector('#ak-cli').closest('.ss2').textContent);
  ok(/export AMV_API_KEY=amv_sk_/.test(t) && /node amv-cli\.mjs/.test(t) && /never on the command line/.test(t), 'three lines to start, and where the key goes', t.slice(0, 200));
}

section('The download is the served file with this deployment’s address in it');
{
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#ak-cli')]);
  const path = await dl.path();
  const got = readFileSync(path, 'utf8');
  ok(dl.suggestedFilename() === 'amv-cli.mjs', 'saved as amv-cli.mjs', dl.suggestedFilename());
  ok(got.includes('const DEFAULT_API = "https://amv-api.example.workers.dev";'), 'the address is written in', got.match(/const DEFAULT_API = [^\n]*/)?.[0]);
  ok(got === SERVED.replace("'__AMV_API__'", '"https://amv-api.example.workers.dev"'), 'and nothing else in the file changed');
}

section('With no server, nothing is handed over and it says why');
{
  const r = await page.evaluate(async () => {
    window.__base = '';
    let fired = false;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { fired = true; return realCreate(b); };
    const out = await _cliDownload();
    URL.createObjectURL = realCreate;
    return { out, fired, toast: [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map(t => t.textContent).join(' ') };
  });
  ok(r.out === false && !r.fired, 'no file is made', r);
  ok(/not connected to its server/.test(r.toast), 'and the person is told', r.toast.slice(0, 160));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-terminal-tool-downloads-ready-to-use') > 0) process.exitCode = 1;
done();
