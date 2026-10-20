/* ══════════════════════════════════════════════════════════════
   BACKGROUND AUTOMATIONS  -  they run whether or not the app is open.

   Before this, "scheduled automations" only fired when the user happened to
   open the app (client-side _runDueTasks). That meant a "7am daily brief"
   only appeared if you opened AMV at 7am - which defeats the point, and the
   product was being sold on it.

   Now: automations live server-side and are executed by a Cloudflare Cron
   trigger. Results are waiting for the user when they come back.

   Requires in wrangler.toml:
     [triggers]
     crons = ["EVERY_5_MIN"]   // use the 5-minute cron expression here
   ══════════════════════════════════════════════════════════════ */

/* How many scheduled jobs a plan includes.

   It used to be a flat 25 for every paid plan, which answered neither of the
   two questions a customer actually has: what do I get, and what does paying
   more get me. Now it scales, and the number is stated on screen rather than
   discovered by hitting it.

   Autonomous work is the most expensive thing AMV does - a job runs whether or
   not anybody is watching - so the free tier gets exactly one weekly job. That
   is enough to see it genuinely work, and not enough to run a business on. */
const AUTO_MAX_BY_PLAN = { free: 0, pro: 5, elite: 25, ultra: 100 };
const AUTO_MAX_PER_USER = 100;                   // hard cap: no runaway fan-out
/* The results list was never trimmed. It is read on every Crew screen and
   appended to on every run, so it grows without limit - and the record it lives
   on is read by the tick every five minutes. Bounded here, newest kept. */
const AUTO_RESULTS_KEEP = 200;
/* Crew and scheduled autonomy need a paid plan. The plans page has always said
   so ("Autonomous agents and Crew" is listed under Pro); nothing enforced it. */
const AUTO_MIN_PLAN = 'pro';
function _autoMaxFor(plan, cfg){
  if(plan === 'team') return Math.min(AUTO_MAX_PER_USER, 5 * _teamSeatCount(cfg));
  if(plan === 'custom') { const r = _customRank(cfg); return r >= 3 ? 100 : r >= 2 ? 25 : r >= 1 ? 5 : 1; }
  return AUTO_MAX_BY_PLAN[plan] || 1;
}
const AUTO_INTERVALS = { '10min': 600e3, '30min': 1800e3, hourly: 3600e3, daily: 86400e3, weekly: 604800e3 };

/* ---- HOW MUCH A BACKGROUND JOB IS ALLOWED TO DO ON ITS OWN ----------------

   Three levels, ordered, least free to most:

     suggest  AMV does not run the job. When it comes due it says the job is
              due and what it would produce, and waits to be asked. Nothing is
              generated, so nothing is spent.
     require  AMV does the work and stops before delivery. The finished result
              waits in the approval queue. This is the default and stays it.
     auto     AMV does the work and delivers it - email, or waiting in the app.

   There used to be two, and 'suggest' is not a label on top of them: at that
   level the runner is never called, so the difference is visible on the bill as
   well as on the screen.

   The ordering exists because of the CEILING. An account can set the highest
   level any of its jobs may reach, and the cron takes the lower of the two
   every run. That is what makes "never let anything send on its own" a real
   setting rather than a promise about how carefully somebody configures each
   job: a job set to auto under a ceiling of require executes as require, and a
   job created later inherits the same limit without anyone remembering to set
   it. It is enforced where the work happens, so nothing that edits a job can
   route around it. */
const AUTO_APPROVALS = ['suggest', 'require', 'auto'];
const AUTO_APPROVAL_RANK = { suggest: 0, require: 1, auto: 2 };
function _autoApprovalOf(v, fallback) {
  return AUTO_APPROVALS.includes(v) ? v : (fallback || 'require');
}
/* The level a run ACTUALLY executes at: the job's own, capped by the account's
   ceiling. Read at run time rather than written into the job, so raising the
   ceiling restores what each job was already set to instead of having flattened
   them all permanently. */
function _autoEffective(item, rec) {
  /* A job with NO approval field at all is one created before the field
     existed, and it has always delivered. Defaulting it to 'require' here reads
     as the careful choice and is actually a silent behaviour change: every
     one of those jobs would stop emailing, and the person would experience
     that as the product breaking rather than as a new safety feature.

     So the default for a MISSING field is what it has always done, and the
     default for a field somebody is SETTING is the careful one - which is why
     this is not the same as _autoApprovalOf's fallback. New jobs get 'require'
     from autoCreate; old jobs keep what they had. */
  const want = (item && AUTO_APPROVALS.includes(item.approval)) ? item.approval : 'auto';
  const cap = _autoApprovalOf(rec && rec.ceiling, 'auto');
  return AUTO_APPROVAL_RANK[want] <= AUTO_APPROVAL_RANK[cap] ? want : cap;
}
const AUTO_MAX_RESULTS = 50;
// The cron fires every 5 minutes, so the shortest meaningful interval is ~10min.
// We keep a floor so nobody can schedule a job that hammers the model every tick.
const AUTO_MIN_INTERVAL = 600e3;

function _autoKey(email){ return String(email||'').toLowerCase(); }

/* ---- list a user's automations ---- */
async function autoList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const rec = (await DB.get(env, 'auto', _autoKey(user.email))) || { items:[], results:[] };
  /* What this account can actually DO with an automation, so the app promises
     that and nothing more: whether results can reach an inbox, and whether the
     plan can run background work at all. */
  const budget = await _budgetFor(env, user);
  /* WHAT EACH JOB WILL NEED, BEFORE IT GETS THERE.

     A run that stops for a missing permission says so against that run - which
     is right, and is too late to be the only place it is said. Somebody sets a
     job up at noon and finds out at 7pm that AMV cannot finish it. Resolved
     here too, on the list itself, so the gap is visible while they are still
     sitting in front of it.

     One read of what they have connected for the whole list, not one per job,
     because this is a screen somebody opens constantly. */
  let _conn = {};
  try { _conn = await _autoConnected(env, user.email); } catch (e) { _conn = {}; }
  const _items = (rec.items || []).map((it) => {
    const n = _autoNeedsFor(it, _conn, it.discoveredNeeds);
    return _hookShown(n.ready ? it : Object.assign({}, it, { willNeed: n.missing }));
  });
  return json({ ok:true, items: _items, results: (rec.results||[]).slice(-AUTO_MAX_RESULTS),
                /* Read back what the account has told its background work to do,
                   so the screen and the chat show the same standing instruction
                   rather than each remembering its own. */
                standing: rec.standing || '',
                quiet: (rec.quiet && Number.isInteger(rec.quiet.from)) ? rec.quiet : null,
                never: _neverList(rec),
                /* AT MOST ONE, ever. Two offers on one screen is a settings
                   page nobody asked for, and the whole justification for this
                   is that it arrives where the person already is. */
                offer: (rec.items || []).map(it => _offerFor(rec, it)).filter(Boolean)[0] || null,
                /* The highest level any of this account's jobs may reach. The
                   screen has to show it, because a job displaying "autonomous"
                   under a ceiling of "ask first" would be lying about what
                   happens tonight. */
                ceiling: _autoApprovalOf(rec.ceiling, 'auto'),
                emailReady: await _emailReachesNow(env), canSchedule: budget.ceiling > 0, plan: budget.plan,
                // What this account may have, so the app offers exactly that.
                free: budget.free, maxAutomations: budget.max,
                minRepeat: budget.free ? FREE_AUTO_REPEAT : null });
}

/* AMV-079: whether an account can run background work AT ALL.

   Automations spend real money on a schedule with nobody watching, so they are
   charged against the same monthly ceiling as interactive use - and an account
   with no paid budget has a ceiling of zero. The cron already knew that and
   deactivated such automations on their first due run. What it did not do was
   tell anybody: the user scheduled a daily brief, saw "Scheduled - it'll run in
   the background", and it silently never ran. That is a feature that exists
   only as a message, which is the one thing AMV does not ship.

   So the same rule is applied at CREATION, where it can be explained. */
/* AMV-087: one free automation, on purpose.

   Background work is the strongest reason anyone comes back to AMV, and it was
   behind the paywall - so the people most likely to churn were the only ones
   who never saw it. Charging for the thing that creates the habit is the wrong
   way round: you cannot convert someone who never found out what they were
   converting to.

   So a free account gets exactly ONE, weekly, on the cheapest engine, with no
   web search - because searching is where the money goes - and its own hard
   ceiling. Worst case is a few cents a month, and only for free users who set
   one up at all. That is a marketing budget, not a leak. */
const FREE_AUTO_MAX          = 1;
const FREE_AUTO_REPEAT       = 'weekly';
const FREE_AUTO_CEILING_USD  = 0.10;      // hard monthly cap for a free account
const FREE_AUTO_MAX_TOKENS   = 1200;

/* The budget for a REQUEST, as opposed to for an entitlement record.

   requireUser has already resolved the effective plan, including a team's
   (AMV-100), so re-reading the entitlement here would cost a read and miss the
   team plan entirely. The fallback is not decoration: treating a missing plan
   as free would silently shape a paying customer's automation down to one
   weekly job, and they would have no way to tell why. */
async function _budgetFor(env, user){
  /* requireUser has already resolved the family, so this costs nothing. */
  if(user && user.plan) return _autoBudget({ plan: user.plan, custom: user.customCfg }, user.family);
  const ent = (await DB.get(env, 'ent', (user && user.email) || '')) || { plan: 'free' };
  return _autoBudget(ent, await _familyOf(env, (user && user.email) || '', ent));
}

/* The budget for background work.

   `family` is a second argument rather than a field on the entitlement because
   that is where it lives: membership and its limits are on the FAMILY record,
   and denormalising a parent's cap onto every child's entitlement would mean a
   parent lowering it had to find and rewrite every one - with a window in
   between where some children are still spending against the old number.

   It has to be here at all because the ceiling was computed from the plan and
   nothing else. A parent who set $10 a month bounded their child's chat and
   texting, and then any automation that child had scheduled ran to
   the PLAN's ceiling instead - unattended, monthly, and invisible to the
   person who set the limit. The limit somebody sets has to hold everywhere,
   and the place it is easiest to miss is the work that runs while nobody is
   watching. */
function _autoBudget(ent, family){
  const plan = _planOf(ent || {});
  const planPrice = _planPriceUSD(plan, ent && ent.custom);
  const max = _autoMaxFor(plan, ent && ent.custom);
  const free = !(planPrice > 0);
  /* A free account's automation ceiling is its own small number, not the plan
     backstop - that is what lets its one weekly job run at all. */
  const base = free ? FREE_AUTO_CEILING_USD : planPrice * 0.45;
  /* The same ceiling every other spending path asks for, so a family cap
     cannot mean one thing to chat and another to the cron. Null when neither
     a plan backstop nor a family cap applies, which is the free case. */
  const shared = _monthlyCeilingUSD({ plan, customCfg: ent && ent.custom, family });
  const ceiling = shared == null ? base : Math.min(base, shared);
  return { plan, ceiling, free, max, familyCapped: shared != null && shared < base };
}

/* ---- create an automation ---- */
/* THE MOST-USED LIST, AND WHY IT IS ALLOWED TO BE EMPTY.

   Returns catalogue ids and how many times each has been turned into a real
   job, most first. It reads one aggregate record: counts and nothing else, no
   email, no job text, nothing that could be traced to a person.

   A MINIMUM BEFORE IT WILL RANK ANYTHING. With three jobs created in total, a
   "top 10 most used" is a list of three coincidences presented as a trend, and
   the first person to read it would be misled by their own data. Under the
   floor it returns `enough:false` and the interface says there is not enough
   yet - which is the honest answer and, at launch, the true one for a while.

   Public on purpose: it is aggregate counts of a public catalogue, it makes the
   catalogue better for somebody deciding what to try, and requiring a login to
   read a leaderboard of your own product's features helps nobody. */
