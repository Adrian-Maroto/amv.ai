/* A COMMAND DOES NOT INHERIT YOUR KEYS.  (AMV-AUD-005)

   Every command AMV ran on somebody's computer, and every connector, inherited
   the whole environment of the terminal the bridge was started in - the cloud
   keys, API tokens, npm auth token and SSH agent a developer's shell carries.
   A command is chosen by a model; a connector is somebody else's program.

   Now a child gets an allowed list of settings a build needs and no credential
   lives in, plus - for a connector - the credentials typed in for it. The old
   behaviour is an opt-in named for what it does, --share-environment, and the
   bridge says so in its terminal and to the page.

   Real bridges, started from an environment seeded with fake secrets, and the
   children report back exactly what they were given. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const AWKWARD = join(ROOT, 'tests', 'fixtures', 'mcp-awkward-server.mjs');
const NODE = '"' + process.execPath + '"';

const SECRETS = {
  AWS_SECRET_ACCESS_KEY: 'fake-aws-secret-1234',
  OPENAI_API_KEY: 'fake-model-key-5678',
  NPM_TOKEN: 'fake-npm-token-9012',
  GITHUB_TOKEN: 'fake-gh-token-3456',
  SSH_AUTH_SOCK: '/tmp/fake-agent.sock',
  DATABASE_URL: 'postgres://u:fakepw@db/x',
};

const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });

async function startBridge(extraArgs) {
  const box = mkdtempSync(join(tmpdir(), 'amv-env-'));
  const proj = join(box, 'proj'); mkdirSync(proj, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj].concat(extraArgs || []), {
    stdio: ['ignore', 'pipe', 'pipe'],
    /* AMV_BRIDGE_TOKEN is seeded so "never the bridge's own" has something to
       withhold - otherwise that check passes on an environment with nothing in it. */
    env: Object.assign({}, process.env, SECRETS, { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', AMV_BRIDGE_TOKEN: 'fake-bridge-own' }),
  });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b.toString(); });
  child.stderr.on('data', b => { banner += b.toString(); });
  const waitFor = async (re, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
    return null;
  };
  const port = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
  const code = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';
  await waitFor(/Close this window/, 4000);
  const base = 'http://127.0.0.1:' + port;
  const pr = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) });
  const paired = await pr.json().catch(() => ({}));
  const call = async (route, body) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': paired.token || '' },
      body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  const hello = await (await fetch(base + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
  return { child, banner: () => banner, paired, call, hello };
}
const envOfCommand = async (b) => {
  const r = await b.call('exec', { command: NODE + ' -e "process.stdout.write(JSON.stringify(process.env))"' });
  try { return JSON.parse(r.d.stdout); } catch (e) { return { __unreadable: r }; }
};
const leaked = (env) => Object.keys(SECRETS).filter(k => k in env || Object.values(env).includes(SECRETS[k]));

section('By default, a command gets the basics and none of the keys');
const def = await startBridge();
{
  const env = await envOfCommand(def);
  ok(!env.__unreadable, 'the command ran and reported its environment', env.__unreadable);
  ok(leaked(env).length === 0, 'no key, token, agent socket or database URL reached it - this was the finding', leaked(env));
  ok(typeof env.PATH === 'string' && env.PATH.length > 0 && (env.HOME || env.USERPROFILE),
     'but it can still find programs and a home folder, so builds work', { PATH: !!env.PATH, HOME: !!(env.HOME || env.USERPROFILE) });
  ok(env.LANG === 'en_US.UTF-8' && env.LC_ALL === 'en_US.UTF-8', 'and the language settings came through', { LANG: env.LANG, LC_ALL: env.LC_ALL });
  ok(!Object.keys(env).some(k => /^AMV_BRIDGE_/i.test(k)), 'and nothing of the bridge’s own', Object.keys(env).filter(k => /AMV/.test(k)));
  ok(def.paired.sharesEnvironment === false && def.hello.sharesEnvironment === false,
     'the page is told the environment is NOT shared', { pair: def.paired.sharesEnvironment, hello: def.hello.sharesEnvironment });
  ok(/none of this\s+window's keys or tokens/.test(def.banner()), 'and the terminal says what commands get', def.banner().slice(-300));
}

section('A connector gets the basics plus exactly the credentials given to it');
{
  const s = await def.call('mcp/start', { id: 'awk', command: process.execPath, args: [AWKWARD], env: { GITHUB_TOKEN: 'given-to-this-connector' } });
  ok(s.status === 200, 'the connector starts', s.status);
  const r = await def.call('mcp/call', { id: 'awk', method: 'tools/call', params: { name: 'env', arguments: {} } });
  let env = {}; try { env = JSON.parse(r.d.result.content[0].text); } catch (e) {}
  ok(env.GITHUB_TOKEN === 'given-to-this-connector', 'it has the token that was typed in for it', env.GITHUB_TOKEN);
  ok(leaked(env).filter(k => k !== 'GITHUB_TOKEN').length === 0 && env.GITHUB_TOKEN !== SECRETS.GITHUB_TOKEN,
     'and none of the terminal’s - not even the terminal’s own GitHub token', leaked(env));
  await def.call('mcp/stop', { id: 'awk' });
}

section('Sharing everything is a choice, and it is announced');
const shared = await startBridge(['--share-environment']);
{
  const env = await envOfCommand(shared);
  ok(env.AWS_SECRET_ACCESS_KEY === SECRETS.AWS_SECRET_ACCESS_KEY && env.NPM_TOKEN === SECRETS.NPM_TOKEN,
     'with --share-environment, a command sees the terminal’s keys - the old behaviour, on purpose', leaked(env));
  ok(!Object.keys(env).some(k => /^AMV_BRIDGE_/i.test(k)), 'still never the bridge’s own', Object.keys(env).filter(k => /AMV/.test(k)));
  ok(shared.paired.sharesEnvironment === true && shared.hello.sharesEnvironment === true, 'the page is told', shared.paired);
  ok(/--share-environment is ON/.test(shared.banner()), 'and the terminal says so plainly', shared.banner().slice(-300));
}

for (const c of running) try { c.kill('SIGKILL'); } catch (e) {}
report();
done();
