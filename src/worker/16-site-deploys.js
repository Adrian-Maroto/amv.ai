       somebody waiting on an email that is never coming, beside a job showing
       green, so every job in the batch is told. The results themselves are
       safe either way: they are in the app, and this only ever describes which
       half arrived. */
    if(mails.length){
      let wentOut = false;
      try{ wentOut = await _autoEmailBatch(env, email, mails); }catch(e){ wentOut = false; }
      if(!wentOut){
        const why = mails.length > 1
          ? 'The results are here in AMV. The one email carrying them could not be delivered.'
          : 'The result is here in AMV. The email could not be delivered.';
        for(const m of mails) m.item.lastError = why;
      }
      changed = true;
    }

    /* AMV-205: the tick holds this record for the whole of a run, which can be
       seconds, and used to write its whole stale copy back at the end. Anything
       the person did meanwhile - pausing, adding a job, editing one, clearing
       results - was silently undone, and the one that matters is pause: the job
       they stopped carried on running and spending.

       Only what the RUN produced is carried across, applied to the record as it
       is inside the lock. Everything else on it belongs to the person, and is
       left exactly as they left it. */
    if(changed) {
      const ran = new Map((rec.items||[]).map(i => [i.id, i]));
      const produced = (rec.results||[]).slice(-AUTO_RESULTS_KEEP);
      await _withAuto(env, email, (fresh) => {
        for(const item of (fresh.items||[])){
          const after = ran.get(item.id);
          if(!after) continue;
          for(const k of AUTO_CARRY_KEYS) item[k] = after[k];
          /* A job the RUN switched off after five failures stays off. A job the
             PERSON switched off stays off too - so this only ever turns one
             off, never back on. */
          if(after.active === false) item.active = false;
        }
        const known = new Set((fresh.results||[]).map(r => r && r.id).filter(Boolean));
        const fresher = produced.filter(r => r && r.id && !known.has(r.id));
        if(fresher.length) fresh.results = (fresh.results||[]).concat(fresher).slice(-AUTO_RESULTS_KEEP);
      }, { items:[], results:[] });
    }

    /* ONLY NOW. The results are in the record the person reads them from, so
       the mail they were built out of has genuinely been reported and the next
       run should start after it.

       Deliberately AFTER the write-back rather than inside it: these take a
       lock on a different record, and taking a second lock while holding the
       automation record is how a tick that already runs on a deadline acquires
       a way to deadlock. It is also the only ordering that is honest - a
       cursor that moved before the results were saved is a claim that has not
       been earned yet.

       Every failure mode here is a repeat, never a loss: if this does not run,
       or runs and fails, the next run sees the same mail and reports it again. */
    for(const fn of ingestCommits){
      try{ await fn(); }
      catch(e){ audit(env, 'ingest_commit_failed', { email, error: String((e && e.message) || e).slice(0,120) }); }
    }
  }

  /* Running out of time once is a busy minute. Running out of time every tick
     means the due work no longer fits in a tick, and the backlog grows without
     anything failing - every individual run succeeds, and people's jobs still
     arrive later and later. That is the state worth being told about, so it is
     paged rather than logged. */
  if(deferred > 0){
    audit(env, 'auto_tick_deferred', { queued, processed, deferred, ran, failed });
    try{
      await alertOnce(env, 'auto_backlog',
        'THE AUTONOMOUS TICK IS OUT OF TIME. ' + processed + ' of ' + queued + ' accounts with work due were '
        + 'handled and ' + deferred + ' were left for the next run. They are first in line next time, so nothing '
        + 'is lost - but if this keeps happening the due work no longer fits in one tick and people’s jobs are '
        + 'arriving late. Raise the tick budget or spread the work.', 3 * 60);
    }catch(e){}
  }
  return { scanned, ran, failed, queued, processed, deferred, truncated };
}

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
  let taken = false;
  const rec = await _withKind(env, 'site', slug, (cur) => {
    /* A record that does not exist loads as an empty object, so "no owner" is
       not "somebody else's owner" - checking only `!==` claimed every free name
       was taken. */
    if (cur && cur.owner && cur.owner !== owner) { taken = true; return null; }
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

