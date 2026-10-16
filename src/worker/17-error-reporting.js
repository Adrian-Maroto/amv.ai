  /* AMV-033: the other writer of this index, and the one deployDelete races.
     Publishing two pages at once, or publishing one while taking another down,
     both read the list and both write it back - so a page ends up either served
     but unlisted, or listed after it was deleted. */
  await _withKind(env, 'sites', owner, (rec) => {
    rec.slugs = rec.slugs || [];
    if (!rec.slugs.includes(slug)) rec.slugs.push(slug);
  }, { slugs: [] });
  return json({ ok:true, slug, url:_siteUrl(request, slug), updated:rec.updated });
}

/* ---- The user's live sites ---- */
async function deployList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const owner = String(user.email).toLowerCase();
  const idx = (await DB.get(env, 'sites', owner)) || { slugs: [] };
  const sites = [];
  for(const slug of (idx.slugs||[])){
    const rec = await DB.get(env, 'site', slug);
    if(rec && rec.owner === owner){
      sites.push({ slug, title:rec.title, url:_siteUrl(request,slug),
                   updated:rec.updated, views:rec.views||0, bytes:(rec.html||'').length });
    }
  }
  sites.sort((a,b)=>(b.updated||0)-(a.updated||0));
  return json({ ok:true, sites });
}

/* ---- Take a site down ---- */
async function deployDelete(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const owner = String(user.email).toLowerCase();
  const body = await request.json().catch(()=>({}));
  const slug = String(body.slug||'').toLowerCase();
  const rec  = await DB.get(env, 'site', slug);
  if(!rec || rec.owner !== owner) return json({ error:'not found' }, 404);

  /* Through DB, not straight at KV. serveSite READS through DB, so on a
     deployment backed by D1 this deleted a KV key that was never there and left
     the D1 row untouched - the page carried on serving, publicly, after its
     owner took it down. Undoing a publish has to actually unpublish. */
  await DB.del(env, 'site', slug);
  /* AMV-033: the owner's site index is written by publish as well as by this,
     so deleting one page while another is being published loses whichever
     write lands first - and the loss shows up as a page that is either missing
     from the list while still served, or listed after being taken down. */
  await _withKind(env, 'sites', owner, (idx) => {
    idx.slugs = (idx.slugs||[]).filter(x=>x!==slug);
  }, { slugs: [] });
  return json({ ok:true });
}

/* ---- Serve the live page (public, no auth) ----
   Served with CSP `sandbox`, which puts the page in a UNIQUE ORIGIN. It can run
   its own scripts but cannot touch cookies, storage, or any AMV API on this
   origin - so hosting user code can't be turned into an attack on AMV. */
async function serveSite(request, env, slug){
  if(!SLUG_RE.test(slug||'')) return new Response('Not found', { status:404 });
  const rec = await DB.get(env, 'site', slug);
  if(!rec || !rec.html) return new Response('Not found', { status:404 });
