/* ══════════════════════════════════════════════════════════════
   REAL DEPLOYMENT  -  ship a live, public URL.

   "Deploy" used to base64 the page into a URL fragment and tell the user
   "nothing is stored on a server" - which is not a deployment. It broke past
   ~18KB, and the pricing page sells "one-click deploy" and "host multiple
   live apps". So: actually host them.

   POST /deploy         -> publish (auth) -> { url }
   POST /deploy/list    -> the user's live sites
   POST /deploy/delete  -> take a site down
   GET  /s/<slug>       -> the live, public page
   ══════════════════════════════════════════════════════════════ */

const SITE_MAX_BYTES     = 2 * 1024 * 1024;   // 2MB per site
const SITE_MAX_PER_USER  = 25;
const SLUG_RE            = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function _slugify(t){
  return String(t||'app').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32) || 'app';
}
function _siteUrl(request, slug){
  return _publicOrigin(request) + '/s/' + slug;
}

/* ---- Publish ---- */
async function deploySite(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  // AMV-030: bound deploy abuse per user (a handful a minute, a sane daily cap).
  const dblock = await guardAction(env, `deploy:${String(user.email).toLowerCase()}`, 10, 100, 'deploys');
  if(dblock) return dblock;

  const body  = await request.json().catch(()=>({}));
  const html  = String(body.html||'');
  const title = String(body.title||'App').slice(0,80);
  if(!html.trim())            return json({ error:'nothing to deploy' }, 400);
  // AMV-030: measure real UTF-8 BYTES, not UTF-16 string length - otherwise
  // multibyte content slips past the size cap.
  const htmlBytes = new TextEncoder().encode(html).length;
  if(htmlBytes > SITE_MAX_BYTES)
    return json({ error:'Site is too large ('+(htmlBytes/1048576).toFixed(1)+'MB). Limit is 2MB.' }, 413);

  /* WHAT THE PLANS PAGE SELLS, ACTUALLY ENFORCED.

     Deploy had auth, a rate limit, a size cap and a per-user site cap - and no
     PLAN check at all. So any free account could publish and host 25 live sites,
     while the pricing page sells "One-click deploy to a live URL" as an Elite
     feature and "Deploy & host multiple live apps" as Ultra. The headline reason
     to buy Elite was free, and the hosting was on the owner's bill.

     Two tiers, taken from the two places the product already states them - the
     plan feature lists and the comparison table - rather than invented here:
       Elite  one live app
       Ultra  up to SITE_MAX_PER_USER of them
     Pro says "build and run apps in the sandbox", which is running, not
     publishing, so Pro is not a deploy tier.

     A Teams seat ranks as Elite in _planRankOf, so a seat deploys one app,
     which is what the seat is sold as carrying. */
  const rank = _planRankOf(user.plan, user.customCfg);
  if (rank < PLAN_RANK.elite) {
    audit(env, 'deploy_plan_block', { email: user.email, plan: user.plan });
    return json({
      error: 'Publishing to a live URL is part of Elite. Your app still runs here, and you can download it any time.',
      code: 'plan_required', minPlan: 'elite'
    }, 402);
  }
  const maxSites = rank >= PLAN_RANK.ultra ? SITE_MAX_PER_USER : 1;

  const owner = String(user.email).toLowerCase();
  const idx   = (await DB.get(env, 'sites', owner)) || { slugs: [] };

  // Reuse the slug if they're updating an existing site of theirs.
  let slug = body.slug ? String(body.slug).toLowerCase() : '';
  if(slug && !SLUG_RE.test(slug)) return json({ error:'invalid name' }, 400);

  if(slug){
    const existing = await DB.get(env, 'site', slug);
    if(existing && existing.owner !== owner) return json({ error:'that name is taken' }, 409);
  } else {
    /* Elite hosts one; Ultra hosts many. The refusal names the plan that lifts
       it rather than only the number, because "you can host up to 1" with no way
       forward reads as a fault rather than as a tier. */
    if((idx.slugs||[]).length >= maxSites)
      return json(maxSites === 1
        ? { error:'Elite hosts one live app at a time. Replace it, delete it, or move to Ultra to host several.',
            code:'plan_required', minPlan:'ultra' }
        : { error:'You can host up to '+maxSites+' sites. Delete one first.' }, maxSites === 1 ? 402 : 429);
    // find a free slug
    const base = _slugify(title);
    slug = base;
    for(let i=0; i<40; i++){
      const taken = await DB.get(env, 'site', slug);
      if(!taken || taken.owner === owner) break;
      slug = base + '-' + Math.random().toString(36).slice(2,6);
    }
  }

  /* AMV-209: THE NAME IS CLAIMED IN THE SAME BREATH AS IT IS CHECKED.

     The check above reads the slug and refuses when somebody else holds it, and
     then this wrote. Two people deploying the same name at the same moment both
     read nothing and both wrote, so one person's public address quietly became
     another's - and the check that exists to prevent exactly that passed for
     both of them. Re-checked inside the lock, which is the only place the
     answer is still true when the write happens. */
  let taken = false, wasNew = true;
  const rec = await _withKind(env, 'site', slug, (cur) => {
    /* A record that does not exist loads as an empty object, so "no owner" is
       not "somebody else's owner" - checking only `!==` claimed every free name
       was taken. */
    if (cur && cur.owner && cur.owner !== owner) { taken = true; return null; }
    if (cur && cur.owner) wasNew = false;
    const next = {
      slug, owner, title, html,
      created: (cur && cur.created) || Date.now(),
      updated: Date.now(),
      views: (cur && cur.views) || 0
    };
    /* Copied onto the loaded record, because the helper writes back what it
       loaded rather than what the mutate returns. */
    if (cur) { for (const k of Object.keys(cur)) if (!(k in next)) delete cur[k]; Object.assign(cur, next); return cur; }
    return next;
  }, {});
  if (taken) return json({ error:'that name is taken' }, 409);

  /* AMV-033: the other writer of this index, and the one deployDelete races.
     Publishing two pages at once, or publishing one while taking another down,
     both read the list and both write it back - so a page ends up either served
     but unlisted, or listed after it was deleted. */
  await _withKind(env, 'sites', owner, (rec) => {
    rec.slugs = rec.slugs || [];
    if (!rec.slugs.includes(slug)) rec.slugs.push(slug);
  }, { slugs: [] });

  /* THE ACTION PROTOCOL, FOR A PAGE (see 09a-action-protocol.js).

     Read back through the same store the public address serves from - not the
     record the write returned - so "it is live" is said only about a page a
     visitor would actually get. A first publish can be taken back by taking it
     down; an update cannot, because the earlier version is not kept, and the
     receipt says so rather than offering a button that would delete the site. */
  let back = null;
  try { back = await DB.get(env, 'site', slug); } catch (e) { back = undefined; }
  const verified = back === undefined ? null : !!(back && back.owner === owner && back.html === html);
  if (verified === false) {
    audit(env, 'deploy_not_confirmed', { by: owner, slug });
    return json({ error: 'not_confirmed', slug,
      message: 'AMV saved the page, but when it checked, the live address did not have it. Open My sites before publishing again.' }, 502);
  }
  const receipt = { action: 'deploy', status: verified ? 'done' : 'unconfirmed', at: Date.now(),
    undo: wasNew ? { label: 'Take the page down', slug } : null,
    irreversible: wasNew ? null : 'The earlier version of this page is not kept, so an update cannot be taken back from AMV. Publish the earlier version again to restore it.' };
  audit(env, 'action_receipt', { by: owner, action: 'deploy', status: receipt.status, undo: !!receipt.undo });
  return json({ ok:true, slug, url:_siteUrl(request, slug), updated:rec.updated, verified, receipt });
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

  // AMV-030: count views in an ATOMIC counter instead of rewriting the whole
  // site record on every read - that was write-amplification on a read-heavy
  // public page AND a lost-update race between concurrent viewers.
  try{ await counter(env, `siteviews:${slug}`, { op:'incr', amount:1, ttlMs: 86400000 * 400 }); }catch(e){}

  return new Response(rec.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // AMV-031: user content is untrusted. Sandbox it, forbid popups/modals and
      // top-navigation, and keep it OUT of search indexes so the trusted hostname
      // can't be used to host indexed phishing pages. (A fully separate untrusted
      // domain, per the audit, remains the recommended production hardening.)
      'Content-Security-Policy': "sandbox allow-scripts allow-forms",
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=60'
    }
  });
}

