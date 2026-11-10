/* ══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR DIRECTORY, AND WHY IT IS NOT A LIST IN THIS FILE.

   Asked for: far more things AMV can connect to, from everywhere, with ten of
   each category on the screen and a full directory of a thousand behind it.

   A thousand entries written out here would be a thousand guesses. The only
   thing that makes a directory entry worth anything is that pressing Connect
   starts something real, and a hand-typed `npx -y @somebody/server-thing` that
   does not exist is worse than no entry: it fails at the one moment somebody
   was trusting the product. Shipping a list like that would also freeze it -
   every entry correct on the day it was written and rotting from then on.

   So the long tail is READ, not written. The official MCP registry publishes
   every server anybody has registered, with its real package name, its real
   version and the environment variables it actually needs, and it is the same
   list the rest of the ecosystem uses. AMV asks it, filters it to the ones its
   own bridge can actually run, and proposes pinned commands for explicit human review. An entry
   AMV cannot start is not shown, because the promise of this screen is that
   entries are metadata, not verified working integrations.

   THROUGH THE WORKER RATHER THAN FROM THE PAGE, for three reasons and all of
   them matter: the page's connect-src does not include the registry and is not
   going to be widened for a catalogue; the answer is identical for everybody,
   so caching it once here costs one request instead of one per visitor; and a
   registry that is slow or down becomes one honest message rather than a
   browser error somebody has to interpret.

   Public, like /v1/everyday and /v1/market/list, and for the same reason: a
   catalogue of what a product can do is the thing somebody reads BEFORE they
   have an account. Nothing here is keyed to a caller and nothing is stored
   against one. */
const MCPREG_BASE   = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const MCPREG_TTL    = 6 * 3600;          // seconds a mapped page stays in KV
const MCPREG_MAX    = 50;                // entries per answer
const MCPREG_PAGES  = 6;                 // upstream pages read to fill one answer
const MCPREG_TIMEOUT = 8000;
/* What the bridge can actually start. `dnx` and anything else is left out
   rather than guessed at - a command AMV cannot run has no business being
   offered, Filtering does not establish publisher trust or runtime safety. */
const MCPREG_RUNTIME = {
  npm:  (id, ver) => ({ command: 'npx',    args: ['-y', ver ? id + '@' + ver : id] }),
  pypi: (id, ver) => ({ command: 'uvx',    args: [ver ? id + '==' + ver : id] }),
  oci:  (id)      => ({ command: 'docker', args: ['run', '-i', '--rm', id] }),
};
function _mcpRegPackageSafe(registry,id,ver){
  if(registry === 'npm') return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(id) &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(ver);
  if(registry === 'pypi') return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+|\.post\d+|\.dev\d+)?$/.test(ver);
  // OCI accepts only a content-addressed image, never a mutable latest tag.
  if(registry === 'oci') return /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(id);
  return false;
}
function _mcpRegText(v, max) {
  /* Registry text is written by whoever published the server, so it is treated
     as hostile input: printable characters only, then a hard length. It is
     escaped again on the way into the page, and this is the other end of that. */
  const src = String(v == null ? '' : v);
  let out = '';
  for (const ch of src) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c !== 127) out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}
/* One registry record to one thing AMV can offer, or null. Null is the normal
   answer: most registered servers are remote HTTP endpoints, and AMV's
   connector support runs a local program through the bridge. Offering a remote
   one would be a button that cannot work. */
function _mcpRegMap(rec) {
  const s = (rec && rec.server) || {};
  const official=rec && rec._meta && rec._meta['io.modelcontextprotocol.registry/official'];
  const status=(official && official.status) || s.status;
  if(status && status !== 'active') return null;
  const pkgs = Array.isArray(s.packages) ? s.packages : [];
  for (const p of pkgs) {
    const t = (p && p.transport && p.transport.type) || 'stdio';
    if (t !== 'stdio') continue;
    const registry = String((p && p.registryType) || '').toLowerCase();
    if(!Object.prototype.hasOwnProperty.call(MCPREG_RUNTIME, registry)) continue;
    const make = MCPREG_RUNTIME[registry];
    const id = _mcpRegText(p.identifier, 140);
    const ver = _mcpRegText(p.version, 80);
    // Reject, rather than truncate or reinterpret, publisher-controlled commands.
    if(id !== p.identifier || ver !== p.version || !_mcpRegPackageSafe(registry,id,ver)) continue;
    if((p.runtimeArguments || []).length || (p.packageArguments || []).length) continue;
    const vars = Array.isArray(p.environmentVariables) ? p.environmentVariables : [];
    if(vars.length > 8 || vars.some(e => !e || !/^[A-Z][A-Z0-9_]{0,59}$/.test(e.name || '') ||
      /^(NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|PATH|HOME|LD_.*|DYLD_.*|UV_.*|PIP_.*|NPM_CONFIG_.*|DOCKER_.*)$/i.test(e.name))) continue;
    const run = make(id, ver);
    /* Runtime arguments the publisher declared - `-y` and friends. Positional
       values only: a named argument needs a value from the person, and this
       screen does not ask for one, so a half-filled command is not offered. */
    const extra = (Array.isArray(p.runtimeArguments) ? p.runtimeArguments : [])
      .filter((a) => a && a.type === 'positional' && a.value)
      .map((a) => _mcpRegText(a.value, 60))
      .filter(Boolean)
      .slice(0, 4);
    const args = run.command === 'npx'
      ? run.args                              // npx already carries -y
      : extra.concat(run.args);
    const env = (Array.isArray(p.environmentVariables) ? p.environmentVariables : [])
      .filter((e) => e && e.name)
      .slice(0, 8)
      .map((e) => ({
        name: _mcpRegText(e.name, 60),
        required: !!e.isRequired,
        secret: !!e.isSecret,
        desc: _mcpRegText(e.description, 160),
      }));
    const full = _mcpRegText(s.name, 160);
    return {
      id: full,
      /* A short name for the card. Registry ids are reverse-DNS
         (`io.github.someone/thing`), and the half after the slash is the part a
         person recognises. */
      name: _mcpRegText(s.title, 80) || full.split('/').pop() || full,
      by: full.split('/')[0] || '',
      desc: _mcpRegText(s.description, 300),
      version: _mcpRegText(s.version, 40),
      command: run.command,
      reviewStatus: 'unreviewed',
      executionWarning: 'Publisher metadata only. Review the package and permissions before installing.',
      args,
      env,
    };
  }
  return null;
}
