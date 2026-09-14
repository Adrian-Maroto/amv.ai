/* NINE THOUSAND CONNECTORS, AND WHY NONE OF THEM ARE WRITTEN DOWN.

   Asked for: far more things AMV can connect to, from everywhere, with a full
   page of a thousand behind a See more.

   A thousand written out in the source would be a thousand guesses - each one
   correct on the day it was typed and rotting from then on, and the first dead
   `npx -y @somebody/thing` is the moment somebody stops believing the rest of
   the page. So the long tail is READ: the Worker asks the official MCP
   registry, which publishes real package names, real versions and the
   environment each server actually declares.

   The whole value of that is in the FILTER, which is what this file is about.
   The registry is mostly remote HTTP endpoints; AMV connector support starts a
   local program through the bridge. An entry AMV cannot start must never
   appear, because the only promise a directory makes is that pressing Connect
   starts something. Measured against the real registry when this was written:
   20,000 servers, 9,451 with a package AMV can run - npm, PyPI or a container.

   Also checked: text from the registry is written by whoever published the
   server, so it is treated as hostile; the same server registered at five
   versions is one entry, not five; and a registry that is slow or down comes
   back as a named failure rather than an empty list, because "nothing matches"
   and "the directory is unreachable" are different facts and showing the first
   when the second is true tells somebody this product connects to nothing. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'directory.harness.mjs');
writeFileSync(harness, src + `
export { connectorDirectory, _mcpRegMap, _mcpRegText, MCPREG_RUNTIME, BACKUP_NEVER };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return {
    _kv: kv,
    AMV_KV: {
      get: async (k, t) => { const v = kv.has(k) ? kv.get(k) : null; return (t === 'json' && v) ? JSON.parse(v) : v; },
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  };
}
const get = (qs) => new Request('https://w/v1/connectors' + (qs || ''));

/* One registry page, answered from here. `served` counts how many times the
   Worker went out, which is how the cache is measured. */
let served = 0, pages = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!/registry\.modelcontextprotocol\.io/.test(u)) return realFetch(url);
  served++;
  const p = pages.shift();
  if (!p) return new Response('{"servers":[],"metadata":{}}', { status: 200 });
  if (p.fail) return new Response('nope', { status: 503 });
  return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const server = (o) => ({ server: Object.assign({ name: 'io.github.x/' + o.id, description: 'd', version: '1.0.0' }, o.s || {}, o.pkgs ? { packages: o.pkgs } : {}, o.remotes ? { remotes: o.remotes } : {}) });
const npmPkg = (id) => [{ registryType: 'npm', identifier: id, version: '2.1.0', transport: { type: 'stdio' } }];

section('Only what the bridge can actually start comes back');
{
  pages = [{ servers: [
    server({ id: 'a', pkgs: npmPkg('@x/a') }),
    server({ id: 'remote-only', remotes: [{ type: 'streamable-http', url: 'https://x/mcp' }] }),
    server({ id: 'b', pkgs: [{ registryType: 'pypi', identifier: 'py-b', version: '0.3', transport: { type: 'stdio' } }] }),
    server({ id: 'c', pkgs: [{ registryType: 'oci', identifier: 'ghcr.io/x/c', transport: { type: 'stdio' } }] }),
    server({ id: 'nuget-one', pkgs: [{ registryType: 'nuget', identifier: 'N', transport: { type: 'stdio' } }] }),
    server({ id: 'http-transport', pkgs: [{ registryType: 'npm', identifier: '@x/h', transport: { type: 'streamable-http' } }] }),
  ], metadata: {} }];
  served = 0;
  const d = await (await W.connectorDirectory(get('?limit=20'), makeEnv())).json();
  const ids = d.servers.map(s => s.id.split('/').pop());
  ok(d.ok === true, 'it answers');
  ok(ids.join(',') === 'a,b,c', 'the three AMV can start, and only those', ids.join(','));
  ok(!ids.includes('remote-only'), 'a remote-only server is not offered', ids.join(','));
  ok(!ids.includes('nuget-one'), 'nor a runtime the bridge does not have', ids.join(','));
  ok(!ids.includes('http-transport'), 'nor a package that speaks HTTP rather than stdio', ids.join(','));
}

section('The command it hands over is one that runs');
{
  pages = [{ servers: [server({ id: 'a', pkgs: npmPkg('@x/a') })], metadata: {} }];
  const d = await (await W.connectorDirectory(get('?limit=5'), makeEnv())).json();
  const s = d.servers[0];
  ok(s.command === 'npx', 'npm becomes npx', s.command);
  ok(s.args.join(' ') === '-y @x/a@2.1.0', 'pinned to the version the registry published', s.args.join(' '));
}

section('The same server at five versions is one entry');
{
  pages = [{ servers: [
    server({ id: 'dup', pkgs: npmPkg('@x/dup'), s: { version: '1.0.0' } }),
    server({ id: 'dup', pkgs: npmPkg('@x/dup'), s: { version: '1.0.1' } }),
    server({ id: 'dup', pkgs: npmPkg('@x/dup'), s: { version: '1.1.0' } }),
  ], metadata: {} }];
  const d = await (await W.connectorDirectory(get('?limit=20'), makeEnv())).json();
  ok(d.servers.length === 1, 'listed once', String(d.servers.length));
}

section('Registry text is written by a stranger, and is treated as such');
{
  /* Built from codepoints rather than typed, so this file itself stays free of
     the characters it is about. */
  const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
  const nasty = 'ok text' + ESC + '[31m' + BEL + 'x'.repeat(600);
  pages = [{ servers: [server({ id: 'n', pkgs: npmPkg('@x/n'), s: { description: nasty, title: 'T' + ESC + 'T' } })], metadata: {} }];
  const d = await (await W.connectorDirectory(get('?limit=5'), makeEnv())).json();
  const s = d.servers[0];
  const ctrl = /[\u0000-\u001f\u007f]/;
  ok(!ctrl.test(s.desc + s.name),
     'control characters are stripped before it is ever sent', JSON.stringify(s.desc.slice(0, 30)));
  ok(s.desc.length <= 300, 'and it cannot be arbitrarily long', String(s.desc.length));
}

section('Filtering does not make a full directory look empty');
{
  /* One upstream page of forty remote-only servers and one runnable. Stopping
     after the first page would answer with one entry and a cursor, which reads
     as a directory with nothing in it. */
  const junk = Array.from({ length: 40 }, (_, i) => server({ id: 'r' + i, remotes: [{ type: 'streamable-http', url: 'https://x' }] }));
  pages = [
    { servers: junk.concat([server({ id: 'good1', pkgs: npmPkg('@x/1') })]), metadata: { nextCursor: 'p2' } },
    { servers: junk.concat([server({ id: 'good2', pkgs: npmPkg('@x/2') })]), metadata: { nextCursor: 'p3' } },
    { servers: [server({ id: 'good3', pkgs: npmPkg('@x/3') })], metadata: {} },
  ];
  served = 0;
  const d = await (await W.connectorDirectory(get('?limit=3'), makeEnv())).json();
  ok(d.servers.length === 3, 'it keeps reading until it has a page worth showing', String(d.servers.length));
  ok(served === 3, 'across as many upstream pages as that took', String(served));
}

section('A search that matches nothing cannot walk the whole registry');
{
  pages = Array.from({ length: 30 }, () => ({ servers: [server({ id: 'r', remotes: [{ type: 'x', url: 'u' }] })], metadata: { nextCursor: 'more' } }));
  served = 0;
  const d = await (await W.connectorDirectory(get('?q=zzzz&limit=40'), makeEnv())).json();
  ok(d.servers.length === 0, 'it answers with nothing found', String(d.servers.length));
  ok(served <= 6, 'after a bounded number of upstream reads', String(served));
}

section('An unreachable registry says so rather than saying empty');
{
  pages = [{ fail: true }];
  const r = await W.connectorDirectory(get('?q=slack'), makeEnv());
  const d = await r.json();
  ok(r.status === 503, 'the status says the upstream failed', String(r.status));
  ok(d.ok === false && d.code === 'directory_unreachable',
     'with a code the screen can act on', JSON.stringify(d));
  ok(!Array.isArray(d.servers), 'and no empty list to be mistaken for an answer', JSON.stringify(d));
}

section('The same question is not asked of the registry twice');
{
  const env = makeEnv();
  pages = [{ servers: [server({ id: 'a', pkgs: npmPkg('@x/a') })], metadata: {} },
           { servers: [server({ id: 'b', pkgs: npmPkg('@x/b') })], metadata: {} }];
  served = 0;
  const a = await (await W.connectorDirectory(get('?q=slack&limit=5'), env)).json();
  const b = await (await W.connectorDirectory(get('?q=slack&limit=5'), env)).json();
  ok(served === 1, 'the second read is served from the cache', String(served));
  ok(JSON.stringify(a.servers) === JSON.stringify(b.servers), 'with the same answer', String(b.servers.length));
  const keys = [...env._kv.keys()];
  ok(keys.length === 1 && keys[0].startsWith('mcpcat:'), 'under a key named for what it is', keys.join(','));
}

section('A cache of a public catalogue stays out of backups');
{
  ok(W.BACKUP_NEVER.includes('mcpcat:'),
     'mcpcat is excluded from every backup', W.BACKUP_NEVER.slice(0, 4).join(','));
}

globalThis.fetch = realFetch;
if (report('the-directory-only-offers-what-can-run') > 0) process.exitCode = 1;
done();
