/* ══ A GITHUB REPOSITORY, OPENED IN THE CLOUD WORKSPACE ═════════════════════

   POST /v1/computer/checkout { repo, ref? } -> the repository's files, at one
   exact commit, in a folder of the person's cloud workspace, ready for the
   build agent to work in - with their computer off.

   THE KEY NEVER GOES IN THE MACHINE. The archive is fetched HERE, with the
   person's GitHub grant, and only the files are handed to the container. A
   token inside the workspace would be readable by everything the repository
   runs there - an install script, a test, a dependency - which is exactly
   where a stolen key is worth most. The way back out (github.push) is the
   server's too, so the workspace never holds anything that can write to
   GitHub.

   WHAT ARRIVES IS SAID. Text files are copied; a binary, a file over the size
   bound or a path that would leave the folder is not, and each one is named in
   the answer - so "the repo is open" is never said about a partial copy
   without saying which part. Pushing back later builds on the commit that was
   copied (the `base` recorded in .amv-checkout.json), so nothing in the
   repository is touched that the person did not change.

   Bounded on every side: the download, what it unpacks to, the number of
   files, each file, and the total. Past any of them it stops and says which. */
const CHECKOUT_DL_MAX = 25 * 1024 * 1024;     // the archive as downloaded
const CHECKOUT_RAW_MAX = 80 * 1024 * 1024;    // what it unpacks to
const CHECKOUT_FILES_MAX = 600;
const CHECKOUT_FILE_MAX = 512 * 1024;
const CHECKOUT_TEXT_MAX = 20 * 1024 * 1024;
const CHECKOUT_MARK = '.amv-checkout.json';

/* Read a stream to bytes, refusing past `max` rather than buffering it. */
async function _ckRead(stream, max){
  const reader = stream.getReader(), parts = [];
  let n = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    n += value.byteLength;
    if(n > max){ try{ await reader.cancel(); }catch(e){} return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let at = 0;
  for(const p of parts){ out.set(p, at); at += p.byteLength; }
  return out;
}

/* A tar archive's regular files, as { path, bytes }. ustar names (prefix +
   name) and pax `path` records, which GitHub uses for long names; links,
   devices and the like are reported, never followed. */
function _ckUntar(buf){
  const files = [], skipped = [];
  const dec = new TextDecoder();
  const str = (o, n) => { const b = buf.subarray(o, o + n); const z = b.indexOf(0); return dec.decode(z < 0 ? b : b.subarray(0, z)); };
  const oct = (o, n) => parseInt(str(o, n).trim() || '0', 8) || 0;
  let at = 0, paxPath = null;
  while(at + 512 <= buf.length){
    if(buf[at] === 0 && buf.subarray(at, at + 512).every(b => b === 0)) break;
    const size = oct(at + 124, 12), type = String.fromCharCode(buf[at + 156] || 48);
    const name = str(at, 100), prefix = str(at + 345, 155);
    const body = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if(type === 'x'){
      for(const rec of dec.decode(body).split('\n')){ const m = rec.match(/^\d+ path=(.*)$/); if(m) paxPath = m[1]; }
      continue;
    }
    if(type === 'g') continue;
    const path = paxPath || (prefix ? prefix + '/' + name : name);
    paxPath = null;
    if(type === '5') continue;
    if(type !== '0' && type !== '\0' && type !== '7'){ skipped.push({ path, why: 'not a regular file' }); continue; }
    files.push({ path, bytes: body });
  }
  return { files, skipped };
}

/* The path inside the repository: the archive's top folder removed, and
   anything that would climb out, or into .git, refused. */
function _ckPath(p){
  const parts = String(p || '').split('/').slice(1).filter(x => x !== '' && x !== '.');
  if(!parts.length) return null;
  if(parts.some(x => x === '..' || x.includes('\\') || /[\u0000-\u001f]/.test(x))) return null;
  if(parts[0] === '.git') return null;
  return parts.join('/');
}

async function computerCheckout(request, env){
  const open = await _computerOpen(request, env, 'checkout');
  if(open.res) return open.res;
  const { user, stub } = open;
  const body = await request.json().catch(() => ({}));
  let repo, ref;
  try{ repo = _ghRepo(body.repo); ref = body.ref ? _ghBranch(body.ref) : ''; }
  catch(e){ return json({ error: 'bad_repo', message: 'Name the repository as owner/name.' }, 400); }

  const got = await connUse(env, user.email, 'repo.read', 'checkout', { attended: true });
  if(!got.ok) return json({ error: got.code, need: 'repo.read',
    message: got.code === 'not_connected' ? 'Connect GitHub under Settings, Integrations, with permission to read your repositories.'
                                          : 'That GitHub connection needs reconnecting.' }, 409);
  const H = _ghHeaders(got.token);

  /* The exact commit, first: everything after this is about that one. */
  let sha = '';
  try{
    if(!ref){
      const r = await fetchDeadline('https://api.github.com/repos/' + repo, { headers: H }, 15000);
      if(!r.ok) return json({ error: 'github_' + r.status, message: r.status === 404 ? 'GitHub has no repository by that name that this connection can see.' : 'GitHub did not answer. Nothing was copied.' }, 502);
      ref = String((await r.json().catch(() => ({}))).default_branch || 'main');
    }
    const c = await fetchDeadline('https://api.github.com/repos/' + repo + '/commits/' + encodeURIComponent(ref), { headers: H }, 15000);
    if(!c.ok) return json({ error: 'github_' + c.status, message: c.status === 404 || c.status === 422 ? 'There is no branch or commit by that name in ' + repo + '.' : 'GitHub did not answer. Nothing was copied.' }, 502);
    sha = String((await c.json().catch(() => ({}))).sha || '');
  }catch(e){ return json({ error: 'github_unreachable', message: 'GitHub did not answer. Nothing was copied.' }, 502); }
  if(!/^[0-9a-f]{40}$/.test(sha)) return json({ error: 'github_bad_answer', message: 'GitHub answered with something AMV could not read. Nothing was copied.' }, 502);

  /* The archive. GitHub redirects it to another host; fetchGuarded re-checks
     every hop and drops the key when the host changes. */
  let bytes;
  try{
    const g = await fetchGuarded('https://api.github.com/repos/' + repo + '/tarball/' + sha, { headers: H }, 60000);
    if(g.blocked) return json({ error: 'blocked', message: g.why }, 502);
    if(!g.response.ok) return json({ error: 'github_' + g.response.status, message: 'GitHub would not hand over the files. Nothing was copied.' }, 502);
    const gz = await _ckRead(g.response.body, CHECKOUT_DL_MAX);
    if(!gz) return json({ error: 'too_large', message: 'That repository is larger than AMV copies into the cloud workspace (25 MB compressed). Nothing was copied.' }, 413);
    bytes = await _ckRead(new Response(gz).body.pipeThrough(new DecompressionStream('gzip')), CHECKOUT_RAW_MAX);
    if(!bytes) return json({ error: 'too_large', message: 'That repository unpacks to more than AMV copies (80 MB). Nothing was copied.' }, 413);
  }catch(e){
    audit(env, 'checkout_failed', { by: user.email, repo, error: String((e && e.message) || e).slice(0, 80) });
    return json({ error: 'github_unreachable', message: 'The files could not be fetched from GitHub. Nothing was copied.' }, 502);
  }

  const untar = _ckUntar(bytes), files = untar.files;
  /* Named as they are in the repository, without the archive's top folder. */
  const skipped = untar.skipped.map(x => ({ path: x.path.split('/').slice(1).join('/') || x.path, why: x.why }));
  const name = repo.split('/')[1].replace(/[^A-Za-z0-9._-]/g, '-');
  const folder = 'repos/' + name;
  const take = [], fatal = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  for(const f of files){
    const p = _ckPath(f.path);
    if(!p){ if(f.path.split('/').length > 1) skipped.push({ path: f.path.split('/').slice(1).join('/'), why: 'outside the folder or in .git' }); continue; }
    if(f.bytes.byteLength > CHECKOUT_FILE_MAX){ skipped.push({ path: p, why: 'larger than 512 KB' }); continue; }
    if(f.bytes.subarray(0, 8000).includes(0)){ skipped.push({ path: p, why: 'not text' }); continue; }
    let text; try{ text = fatal.decode(f.bytes); }catch(e){ skipped.push({ path: p, why: 'not text' }); continue; }
    if(take.length >= CHECKOUT_FILES_MAX || total + text.length > CHECKOUT_TEXT_MAX){ skipped.push({ path: p, why: 'past the limit of what AMV copies' }); continue; }
    total += text.length;
    take.push({ path: p, text });
  }
  if(!take.length) return json({ error: 'nothing_to_copy', message: 'There were no text files AMV could copy from ' + repo + '.', skipped: skipped.slice(0, 50) }, 422);

  await _computerBillAwake(env, user.email, Date.now());
  const call = async (route, payload) => {
    const r = await stub.fetch(new Request('http://amv-computer/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': String(env.AMV_COMPUTER_KEY) }, body: JSON.stringify(payload) }));
    const d = await r.json().catch(() => ({}));
    if(r.status === 401) throw new Error('computer_key');
    if(!r.ok) throw new Error(String(d.error || ('status_' + r.status)));
    return d;
  };
  /* Written a few at a time. A write that fails stops the copy and says how
     far it got - a folder that is partly the repository is not called it. */
  let written = 0;
  try{
    for(let i = 0; i < take.length; i += 8){
      await Promise.all(take.slice(i, i + 8).map(f => call('write', { path: folder + '/' + f.path, content: f.text })));
      written = Math.min(take.length, i + 8);
    }
    await call('write', { path: folder + '/' + CHECKOUT_MARK, content: JSON.stringify({ repo, ref, base: sha, at: Date.now(),
      files: take.length, skipped: skipped.length }, null, 2) + '\n' });
  }catch(e){
    audit(env, 'checkout_partial', { by: user.email, repo, written, of: take.length, error: String((e && e.message) || e).slice(0, 80) });
    return json({ error: e && e.message === 'computer_key' ? 'computer_unavailable' : 'checkout_partial', folder, written, of: take.length,
      message: 'The copy stopped after ' + written + ' of ' + take.length + ' files, so this folder is not the whole repository. Try again.' }, 502);
  }
  /* A local record of what was copied, so "what did I change" is one git
     command in the workspace - the same files, the same commit, no remote and
     no key. Without it the copy is still whole; the answer says it is not
     tracked rather than calling the copy a failure. */
  let tracked = false;
  try{
    const d = await call('exec', { cwd: folder, timeout: 60000,
      command: 'git init -q && git add -A && git -c user.name=AMV -c user.email=amv@amv.invalid commit -q -m "' + sha.slice(0, 12) + ' as copied" && echo amv-tracked' });
    tracked = d.exitCode === 0 && /amv-tracked/.test(String(d.stdout || ''));
  }catch(e){ tracked = false; }
  await _computerBillAwake(env, user.email, Date.now());
  audit(env, 'checkout', { by: user.email, repo, files: take.length, skipped: skipped.length, tracked });
  return json({ ok: true, repo, ref, base: sha, folder, files: take.length, tracked,
    skipped: skipped.slice(0, 50), skippedCount: skipped.length });
}
