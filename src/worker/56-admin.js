/* =====================================================================
   FOUNDER ADMIN - token-gated platform monitoring (auditor #10)
   Lets the operator see real platform-wide spend, users, and abuse signals,
   plus flip the kill switch and inspect/adjust a single user. Protected by
   ADMIN_TOKEN (a secret only you hold) - NOT by user auth, so a normal user
   token can never reach it.
   ===================================================================== */
// increment a short-lived failed-login counter (15-min window) for brute-force defense
async function _noteAuthFail(env, key){
  try{
    const n = parseInt(await env.AMV_KV.get(key) || '0', 10) + 1;
    await env.AMV_KV.put(key, String(n), { expirationTtl: 900 });
  }catch(e){}
}


/* Mark a user active today, counted at most ONCE per day (unique DAU). We set a
   per-user marker with a 2-day TTL; the first mark of the day bumps the counter. */
async function _markActive(env, email){
  try{
    const day = todayKey();
    const marker = `active:${email}:${day}`;
    if(await env.AMV_KV.get(marker)) return;              // already counted today
    await env.AMV_KV.put(marker, '1', { expirationTtl: 2 * 86400 });
    await _growthAdd(env, 'active', day, email);
    /* Coming back is a SECOND distinct day, not a second session - somebody who
       opens AMV twice in one afternoon has not come back yet. The first active
       day is remembered for as long as the funnel counts, so this stays true
       for somebody who returns after a month. */
    const firstKey = `factive:${email}`;
    const raw = await env.AMV_KV.get(firstKey);
    /* WHO IS STILL HERE N WEEKS LATER (retention by signup cohort). "Came
       back once, ever" looks healthy for a product that loses everybody by
       week three. So the first active day's record also notes which weeks
       after it the person was active in - each week counted once, at most
       RET_WEEKS writes for a whole life, no new record kind - into the month
       map the owner's figures already read in one call per shard. A record
       from before this (a bare date) is not counted into a cohort: its
       cohort's size was never counted, so its share would be invented. */
    let rec = null;
    try { rec = raw ? (raw.charAt(0) === '{' ? JSON.parse(raw) : { day: raw, legacy: true }) : null; } catch (e) { rec = { day: String(raw), legacy: true }; }
    if(!rec){
      await env.AMV_KV.put(firstKey, JSON.stringify({ day, w: [] }), { expirationTtl: FUNNEL_TTL_S });
      await _econAdd(env, email, [['ret:' + _cohortWeekOf(day) + ':w0', 1]]);
    } else if(rec.day !== day){
      await _funnelMark(env, email, 'returned');
      const n = Math.floor((Date.parse(day + 'T00:00:00Z') - Date.parse(rec.day + 'T00:00:00Z')) / (7 * 86400000));
      if(!rec.legacy && n >= 1 && n <= RET_WEEKS && !(rec.w || []).includes(n)){
        rec.w = (rec.w || []).concat(n);
        await env.AMV_KV.put(firstKey, JSON.stringify(rec), { expirationTtl: FUNNEL_TTL_S });
        await _econAdd(env, email, [['ret:' + _cohortWeekOf(rec.day) + ':w' + n, 1]]);
      }
    }
  }catch(e){ /* best-effort */ }
}

const RET_WEEKS = 12;
/* The Monday of the week a day falls in: the cohort a person started in. */
function _cohortWeekOf(day){
  const d = new Date(String(day) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
/* The last twelve signup weeks, each with its size and the share of it active
   one, two ... twelve weeks on - only for weeks that have finished. Read from
   the month maps of the last four months: one call per shard per month. */
async function _retentionReport(env, now){
  const t = now || Date.now();
  const months = [];
  for(let i = 0; i < 4; i++){ const d = new Date(t); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const sum = {};
  for(const m of await Promise.all(months.map(m => _econMonth(env, m).catch(() => ({})))))
    for(const [k, v] of Object.entries(m)) if(k.startsWith('ret:')) sum[k] = (sum[k] || 0) + (+v || 0);
  const thisWeek = _cohortWeekOf(new Date(t).toISOString().slice(0, 10));
  const cohorts = [];
  for(let i = 0; i < RET_WEEKS; i++){
    const start = new Date(Date.parse(thisWeek + 'T00:00:00Z') - i * 7 * 86400000).toISOString().slice(0, 10);
    const size = sum['ret:' + start + ':w0'] || 0;
    const weeks = [];
    for(let n = 1; n <= RET_WEEKS; n++){
      const finished = Date.parse(start + 'T00:00:00Z') + (n + 1) * 7 * 86400000 <= t;
      if(!finished) break;
      const c = sum['ret:' + start + ':w' + n] || 0;
      weeks.push({ n, count: c, pct: size ? +((c / size) * 100).toFixed(1) : null });
    }
    cohorts.push({ week: start, size, weeks });
  }
  return { cohorts, weeks: RET_WEEKS };
}

/* ── Growth tracking: a tiny per-day counter so the owner can see TRENDS, not
   just a snapshot. One KV key per day (grow:signup:YYYY-MM-DD). 60-day TTL keeps
   it bounded. This is what turns "you have 40 users" into "signups are up 3x
   week over week" - the number that actually tells you if it's working. ── */
async function _recordGrowth(env, kind, who){
  /* BEST-EFFORT ON FAILURE WAS NOT BEST-EFFORT ON BUDGET.

     This has always been wrapped so a growth stat can never fail a sign-up.
     What it was not doing is YIELDING: it wrote straight to KV, spending the
     same daily allowance the account record needs. Measured on a real
     sign-up, two of the five KV writes were analytics.

     The ceiling above already sheds load in the right order and says so -
     "telemetry and a waitlist are the two least important writes AMV makes".
     A growth counter is telemetry too; it was simply added later and never
     joined the list. Without this, the analytics can consume the budget that
     sign-up needs, which is the one shape where telemetry breaks the thing it
     exists to measure.

     THE TRADE, STATED, BECAUSE IT IS NOT FREE. The check is a counter
     operation. With AMV_COUNTER bound - the configuration the readiness screen
     marks REQUIRED the moment money is involved - it goes to the Durable
     Object and costs no KV write at all, so this is pure gain. Without it, the
     counter falls back to KV and this spends one write to protect one write:
     break-even while the budget is healthy, and a saving of every subsequent
     growth write once it is not. That is the right way round, because the
     whole point is what happens when the budget is gone.

     This is the per-EVENT counter - one write on every sign-up, visit and
     referral - which is what actually amplifies. The funnel above is once per
     user per step, reads first, and is deliberately left alone: gating it
     measured WORSE (9 writes to 11) for a write that mostly never happens. */
  try{ await _growthAdd(env, kind, todayKey(), who); }
  catch(e){ /* growth stats are best-effort, never block signup */ }
}
/* WHERE A GROWTH COUNT GOES (scale audit #40).
   With the counter object bound - every real deployment - a sharded tally:
   no KV write at all, so it needs no place in the non-essential allowance,
   and nothing caps it. That allowance had been capping it: the load probe
   counted 150 of 200 sign-ups in a day and dropped the rest, so the owner's
   growth line would have gone flat on the day growth arrived. And the KV
   form below was a read then a write of ONE key, which loses a count when
   two land together and is refused past about one write a second.
   Without the object (a development machine) it stays in KV, behind the
   allowance, as before. */
async function _growthAdd(env, kind, day, who){
  if(env.AMV_COUNTER){ await _tallyAdd(env, `grow:${kind}:${day}`, who, 1, 60 * 86400000); return; }
  if(kind !== 'active' && !await _nonEssentialWrite(env, 'a growth stat')) return;
  const key = `grow:${kind}:${day}`;
  const cur = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
  await env.AMV_KV.put(key, String(cur + 1), { expirationTtl: 60 * 86400 });
}

/* ── THE FUNNEL ────────────────────────────────────────────────────────────
   Plan population answers "who is paying now". It cannot answer the question
   that decides whether any of the product work is landing: of the people who
   signed up, how many ever got value, how many came back, and how many paid.

   Without it, first-run screens, activation nudges and onboarding copy are all
   judged on feel. With it they are judged on a number.

   Each step is marked ONCE PER USER, ever, and increments a cumulative counter -
   the same approach as the plan population, and for the same reason: the ratios
   stay exact at forty accounts and at four hundred thousand, with no scan.

   No step is inferred. `activated` is a real answer AMV produced for them,
   `returned` is a second distinct day, `paid` is a verified payment. A funnel
   made of proxies tells you a story rather than the truth. */
const FUNNEL_STEPS = ['signup', 'activated', 'returned', 'paid'];
const FUNNEL_TTL_S = 400 * 86400;

async function _funnelMark(env, email, step){
  try{
    /* Trimmed as well as lowercased, so one caller passing a raw typed address
       cannot file the same person under two identities. Normalising at the
       choke point rather than trusting five call sites to agree. */
    const em = String(email || '').toLowerCase().trim();
    if(!em || FUNNEL_STEPS.indexOf(step) < 0) return false;
    const k = `fstep:${em}:${step}`;
    if(await env.AMV_KV.get(k)) return false;            // already counted, ever
    /* DELIBERATELY NOT BEHIND THE NON-ESSENTIAL CEILING, and the measurement
       is why. Each step is marked once per user EVER and the line above reads
       first, so an account costs at most four of these for its whole life -
       it is not what amplifies writes. Putting it behind the ceiling cost one
       counter op to protect one write that mostly does not happen, which on a
       deployment with no Durable Object is a net LOSS: measured, sign-up went
       from 9 writes to 11. The per-event counter below is the one that needed
       it. */
    await env.AMV_KV.put(k, String(Date.now()), { expirationTtl: FUNNEL_TTL_S });
    await _tallyAdd(env, `funnel:${step}`, em, 1);
    if(step !== 'signup') await _recordGrowth(env, step, em);
    /* How long it took them to pay, accumulated rather than stored per user, so
       the average is available without reading every account. */
    /* HOW LONG TO THE FIRST REAL ANSWER (Oct 31 audit, item 98: "first value
       in under three minutes"). Counted into a few buckets, once per account,
       so the share that got there fast is one read - not a per-user record. */
    if(step === 'activated'){
      const acct = await DB.get(env, 'acct', em);
      const ms = acct && acct.createdAt ? Date.now() - acct.createdAt : -1;
      if(ms >= 0) await _tallyAdd(env, 'funnel:ttv:' + _ttvBucket(ms), em, 1);
    }
    if(step === 'paid'){
      const acct = await DB.get(env, 'acct', em);
      const age = acct && acct.createdAt ? Date.now() - acct.createdAt : 0;
      if(age > 0){
        await counter(env, 'funnelttpsum', { op: 'incr', amount: age / 86400000 });
        await counter(env, 'funnelttpn', { op: 'incr', amount: 1 });
      }
    }
    return true;
  }catch(e){ return false; }   // a funnel stat must never fail a real action
}

const TTV_BUCKETS = [['3m', 3 * 60e3], ['10m', 10 * 60e3], ['1h', 3600e3], ['1d', 86400e3], ['later', Infinity]];
function _ttvBucket(ms){ for (const [k, max] of TTV_BUCKETS) if (ms < max) return k; return 'later'; }

async function _funnelReport(env){
  const out = {};
  for(const step of FUNNEL_STEPS){
    try{ out[step] = Math.max(0, await _tallyGet(env, `funnel:${step}`)); }
    catch(e){ out[step] = 0; }
  }
  const n = out.signup || 0;
  const pct = v => (n > 0 ? +((v / n) * 100).toFixed(1) : null);
  let days = null;
  try{
    const sum = (await counter(env, 'funnelttpsum', { op: 'get' })).value || 0;
    const cnt = (await counter(env, 'funnelttpn', { op: 'get' })).value || 0;
    if(cnt > 0) days = +(sum / cnt).toFixed(1);
  }catch(e){}
  /* Time from sign-up to the first answer, among those who got one. */
  const ttv = {};
  let ttvN = 0;
  for(const [k] of TTV_BUCKETS){
    try{ ttv[k] = Math.max(0, await _tallyGet(env, 'funnel:ttv:' + k)); }catch(e){ ttv[k] = 0; }
    ttvN += ttv[k];
  }
  return {
    ...out,
    firstAnswer: { within: ttv, measured: ttvN, under3MinPct: ttvN > 0 ? +((ttv['3m'] / ttvN) * 100).toFixed(1) : null },
    activatedPct: pct(out.activated),
    returnedPct: pct(out.returned),
    paidPct: pct(out.paid),
    avgDaysToPay: days,
    /* Counting started when this shipped, so accounts that existed before it
       are not in the denominator. Said out loud rather than left for somebody
       to discover when the numbers do not match the user count. */
    note: 'Counted from when funnel tracking was switched on, so accounts older than that are not included.',
  };
}

/* Read the last N days of a growth series as [{date, count}], oldest first. */
async function _growthSeries(env, kind, days){
  const out = [];
  const now = new Date();
  for(let i = days - 1; i >= 0; i--){
    const d = new Date(now.getTime() - i * 86400000);
    const key = `grow:${kind}:${d.toISOString().slice(0,10)}`;
    /* Both stores: the tally, and the KV count kept before it existed. */
    const kv = parseInt(await env.AMV_KV.get(key) || '0', 10) || 0;
    const t = env.AMV_COUNTER ? await _tallyGet(env, key) : 0;
    out.push({ date: d.toISOString().slice(0,10), count: kv + t });
  }
  return out;
}

/* NOTIFY ME, COUNTED. Each press is a waitlist entry keyed
   waitlist:app-<slug>:<email>, so a request is one per person per app and the
   count is people, not presses. Read in pages and bounded: past the ceiling
   the counts are a sample, and `complete` says so rather than letting a
   partial tally pass for the whole one. */
async function _appRequestCounts(env) {
  const counts = {};
  let cursor, pages = 0, complete = true;
  try {
    do {
      const page = await env.AMV_KV.list({ prefix: 'waitlist:app-', cursor, limit: 1000 });
      for (const k of page.keys) {
        const slug = String(k.name).slice('waitlist:app-'.length).split(':')[0];
        if (slug) counts[slug] = (counts[slug] || 0) + 1;
      }
      cursor = page.list_complete ? null : page.cursor;
      pages++;
      if (cursor && pages >= 10) { complete = false; break; }
    } while (cursor);
  } catch (e) { return { top: [], complete: false, error: 'could not read the waitlist' }; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([app, people]) => ({ app, people }));
  return { top, complete };
}

/* TIME TO THE FIRST WORD, AS A HISTOGRAM WITH PERCENTILES (Nov 3 audit
   REL-010). Buckets by upper bound; the individual request is never kept.
   p10000 and p30000 split what used to be one open-ended 'slow' (5s and up),
   because a p99 that can only say "over five seconds" cannot tell a slow
   provider from a hung one. The earlier buckets keep their meaning, so a
   month that straddles the change still adds up. A percentile is the upper
   bound of the bucket it falls in - an honest "under N ms", never a number
   finer than what was counted. */
const TTFB_BUCKETS = [['p500', 500], ['p1000', 1000], ['p2500', 2500], ['p5000', 5000], ['p10000', 10000], ['p30000', 30000], ['slow', null]];
function _ttfbBucket(ms) {
  for (const [name, upTo] of TTFB_BUCKETS) if (upTo != null && ms < upTo) return name;
  return 'slow';
}
function _ttfbPercentiles(buckets) {
  const n = TTFB_BUCKETS.reduce((a, [b]) => a + (+buckets[b] || 0), 0);
  if (!n) return { samples: 0, p50: null, p95: null, p99: null };
  const at = (q) => {
    const need = Math.ceil(q * n); let seen = 0;
    for (const [b, upTo] of TTFB_BUCKETS) { seen += +buckets[b] || 0; if (seen >= need) return upTo == null ? 'over 30000' : 'under ' + upTo; }
    return 'over 30000';
  };
  return { samples: n, p50: at(0.50), p95: at(0.95), p99: at(0.99) };
}
async function _ttfbBuckets(env, month, opt) {
  const buckets = {};
  await Promise.all(TTFB_BUCKETS.map(async ([b]) => {
    const per = await Promise.all(Object.keys(ENGINES).map(k => _tallyGet(env, `ttfb:${k}:${b}:${month}`, opt).catch(() => 0)));
    buckets[b] = per.reduce((a, c) => a + c, 0);
  }));
  return buckets;
}

/* THE SERVICE OBJECTIVES, FROM WHAT HAPPENED (Nov 1 audit REL-010).
   docs/SLO.md sets them; this measures them from the month's own counts -
   answers delivered whole, how fast they started, background runs that
   produced their result - and says how much of each error budget is spent.
   Over budget is an incident: the owner is told once a day (runSloCheck). */
const SLO_TARGETS = [
  { id: 'chat_delivered', what: 'A chat answer is delivered whole', objective: 99.5, classes: ['chat', 'api'] },
  { id: 'background_runs', what: 'A background or agent run produces its result', objective: 99, classes: ['background', 'agent'] },
];
async function _sloReport(env, month, opt) {
  const oc = await _outcomes(env, month, opt).catch(() => ({}));
  const out = [];
  for (const t of SLO_TARGETS) {
    let good = 0, runs = 0;
    for (const c of t.classes) { if (oc[c]) { good += oc[c].good; runs += oc[c].runs; } }
    const actual = runs ? (good / runs) * 100 : null;
    const allowed = 100 - t.objective;
    const used = runs ? ((runs - good) / runs) * 100 / allowed * 100 : 0;
    out.push({ id: t.id, what: t.what, objective: t.objective, runs, actualPct: actual == null ? null : +actual.toFixed(2),
               budgetUsedPct: +used.toFixed(1), status: runs < 20 ? 'too_few' : used >= 100 ? 'broken' : used >= 50 ? 'burning' : 'ok' });
  }
  /* How fast answers start: the share inside five seconds, from the buckets. */
  const bk = await _ttfbBuckets(env, month, opt);
  const n = TTFB_BUCKETS.reduce((a, [b]) => a + bk[b], 0), fast = bk.p500 + bk.p1000 + bk.p2500 + bk.p5000;
  const share = n ? (fast / n) * 100 : null;
  const pc = _ttfbPercentiles(bk);
  out.push({ id: 'chat_starts_fast', what: 'A chat answer starts within 5 seconds', objective: 99.5, runs: n,
             p50: pc.p50, p95: pc.p95, p99: pc.p99,
             actualPct: share == null ? null : +share.toFixed(2), budgetUsedPct: n ? +(((n - fast) / n) * 100 / 0.5 * 100).toFixed(1) : 0,
             status: n < 20 ? 'too_few' : (n - fast) / n * 100 >= 0.5 ? 'broken' : (n - fast) / n * 100 >= 0.25 ? 'burning' : 'ok' });
  return out;
}
/* Once a day at most per objective: an objective over its budget is said to
   the owner with the runbook to open. */
async function runSloCheck(env) {
  const month = monthKey();
  const slo = await _sloReport(env, month, { legacy: false });
  let told = 0;
  for (const o of slo) {
    if (o.status !== 'broken') continue;
    const flag = 'slo:' + o.id + ':' + todayKey();
    if (await env.AMV_KV.get(flag)) continue;
    await env.AMV_KV.put(flag, '1', { expirationTtl: 2 * 86400 });
    await notify(env, 'Objective broken: ' + o.what + ' - ' + o.actualPct + '% this month against ' + o.objective + '%, ' + o.budgetUsedPct + '% of the error budget spent. See docs/INCIDENT-RUNBOOK.md, "An objective is broken".');
    told++;
  }
  return { checked: slo.length, told };
}
async function adminStats(request, env) {
  /* AMV-052: through the SAME gate as every other admin route. This was a bare
     token comparison with no rate limit, so three of the sixteen admin routes
     were an unbounded channel for guessing the token while the other thirteen
     were not - and an attacker only has to find the unbounded one. */
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }

  const today = todayKey(), month = monthKey();
  // global spend today (atomic counter) + cap
  const gSpend = await _globalSpendToday(env, today);
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1';

  // list entitlements (paying users) via the durable layer (D1 query or KV scan)
  let users = [], plans = { free: 0, pro: 0, elite: 0, ultra: 0, custom: 0, team: 0 };
  let mrr = 0, pastDue = 0, atRisk = 0;

  /* Bounded on purpose, and reported. Past this many accounts the per-account
     lists below are a sample - the headline money comes from the maintained
     counters instead, which are exact at any size. */
  const SCAN_LIMIT = 2000;
  const { rows: entRows, truncated } = await scan(env, 'ent', SCAN_LIMIT, 'owner stats screen');
  for (const row of entRows) {
    const e = row.value || {};
    const email = row.id;
    /* The EFFECTIVE plan, not the one that was sold. Counting a subscription
       whose payment failed as revenue overstates MRR and hides the problem -
       the owner needs to see money at risk, not money assumed. */
    const plan = _planOf(e);
    /* _planPriceUSD, not a local table: a per-seat plan's revenue is its seat
       count times the seat price, and a table keyed by plan name reports every
       Teams customer - however large - as zero. */
    if (e.pastDueSince) {
      pastDue++;
      atRisk += _planPriceUSD(e.plan, e.custom);
    }
    plans[plan] = (plans[plan] || 0) + 1;
    const revenue = _planPriceUSD(plan, e.custom);
    mrr += revenue;
    const cost = (await counter(env, `cost:${email}:${month}`, { op: 'get' })).value || 0;
    if (plan !== 'free' || cost > 0) users.push({ email, plan, monthCostUSD: +cost.toFixed(3), revenue });
  }

  /* AMV-071: UNIT ECONOMICS.
     A single blended cost number cannot answer the questions that decide
     whether this business works: is each tier profitable, which accounts cost
     more than they pay, and where is the money actually going. Those are the
     numbers you steer on, and none of them were here. */
  const cohorts = {};
  for (const u of users) {
    const c = cohorts[u.plan] || (cohorts[u.plan] = { plan: u.plan, users: 0, revenue: 0, cost: 0 });
    c.users++; c.revenue += u.revenue; c.cost += u.monthCostUSD;
  }
  const byPlanEconomics = Object.values(cohorts).map(c => ({
    plan: c.plan, users: c.users,
    revenue: +c.revenue.toFixed(2), cost: +c.cost.toFixed(2),
    grossMargin: +(c.revenue - c.cost).toFixed(2),
    // A free cohort has no revenue, so a margin PERCENTAGE is meaningless there
    // - null says "not applicable" instead of printing a fake -100%.
    grossMarginPct: c.revenue > 0 ? +(((c.revenue - c.cost) / c.revenue) * 100).toFixed(1) : null,
    costPerUser: +(c.cost / Math.max(1, c.users)).toFixed(3),
  })).sort((a, b) => b.revenue - a.revenue);

  /* The accounts that quietly destroy an AI business: paying, but costing more
     than they pay. Worth seeing individually, because the answer is usually a
     conversation rather than a limit. */
  const unprofitable = users
    .filter(u => u.revenue > 0 && u.monthCostUSD > u.revenue)
    .map(u => ({ email: u.email, plan: u.plan, revenue: u.revenue, cost: u.monthCostUSD,
                 lossUSD: +(u.monthCostUSD - u.revenue).toFixed(2) }))
    .sort((a, b) => b.lossUSD - a.lossUSD).slice(0, 20);
  // Free users cost real money too - that is the price of the funnel, and it
  // belongs on screen next to what the funnel returns.
  const freeCost = +(cohorts.free ? cohorts.free.cost : 0).toFixed(2);

  // Where the money went this month, and what caching saved.
  const features = ['chat', 'crew', 'build', 'code', 'voice', 'automation', 'background', 'agent', 'api', 'batch', 'other', 'sms', 'widget'];
  const featureCost = {};
  for (const feat of features) {
    const v = await _tallyGet(env, `featcost:${feat}:${month}`);
    if (v > 0) featureCost[feat] = +v.toFixed(2);
  }
  const cacheSaved = +(await _tallyGet(env, `cachesave:${month}`)).toFixed(2);
  /* Cost per GOOD outcome, by kind of work (Nov 1 audit USAGE-005): an answer
     delivered whole, a background or agent run that produced its result in
     the form promised, an action AMV read back as done. */
  const outcomes = await _outcomes(env, month).catch(() => ({}));
  try { const a = await _actOutcomes(env, month); outcomes.actions = { runs: a.verified + a.unchecked + a.not_confirmed + a.unverifiable + a.failed, good: a.verified, goodPct: a.verifiedRatePct, costUSD: 0, costPerGoodUSD: null }; } catch (e) {}

  // top spenders (who costs us most this month) - abuse / margin watch
  const topSpenders = [...users].sort((a, b) => b.monthCostUSD - a.monthCostUSD).slice(0, 20);
  /* AMV-088: when the scan saw everything, the scan IS the truth and the
     counters are checked against it. When it did not, the counters are the only
     thing that can be right - and the response says which happened, so nobody
     reads a sample as a total. */
  /* AMV-095: whether the answers are any good - the one number that decides
     whether anyone stays, and the only one that was never measured. */
  const quality = await _qualityReport(env);
  /* AMV-098: how long people waited. The average is the headline; the buckets
     are what tell you whether it is one bad engine or all of them. */
  const speed = await (async () => {
    /* Read together, not one after another: each is a sum of shares. */
    const [sum, n] = await Promise.all([_tallyGet(env, `ttfbsum:${month}`), _tallyGet(env, `ttfbn:${month}`)]);
    const buckets = await _ttfbBuckets(env, month);
    const fast = buckets.p500 + buckets.p1000;
    const pc = _ttfbPercentiles(buckets);
    return { samples: n, avgFirstTokenMs: n ? Math.round(sum / n) : null, buckets,
             p50: pc.p50, p95: pc.p95, p99: pc.p99,
             underOneSecondPct: n ? +((fast / n) * 100).toFixed(1) : null };
  })();
  const pop = await _planPopulation(env);
  const popTotal = Object.values(pop).reduce((a, b) => a + b, 0);
  /* Revenue on the per-seat plan is seats, not accounts, so it comes from the
     seat counter rather than from multiplying a head count by a price that does
     not exist for that plan. A custom plan's price is per account and unknown
     here, so the scan above is what carries it - reported, not guessed. */
  const seatsSold = await _teamSeatsSold(env);
  let popMrr = seatsSold * TEAM_SEAT_PRICE_USD;
  for (const [plan, n] of Object.entries(pop)) {
    if (plan === 'team' || plan === 'custom') continue;
    popMrr += _planPriceUSD(plan) * n;
  }
  const totalCost0 = await _tallyGet(env, `costtotal:${month}`);

  if (truncated) {
    // The scan is a sample; take population and revenue from the counters.
    plans = pop;
    mrr = popMrr;
  }
  const paying = truncated
    ? Object.entries(pop).filter(([p]) => p !== 'free').reduce((n, [, v]) => n + v, 0)
    : users.filter(u => u.plan !== 'free').length;

  // Growth over time - the numbers that show whether it's WORKING, not just a
  // snapshot. 30-day signup + active series, plus today's figures.
  const signups30 = await _growthSeries(env, 'signup', 30);
  const active30 = await _growthSeries(env, 'active', 30);
  /* AMV-075: referral conversions, so the invite loop is a measured channel
     rather than a feature nobody can tell is working. A conversion is counted
     when an invited account has genuinely started using AMV - the same bar the
     reward is paid at - so this series is real activation, not raw signups. */
  const referrals30 = await _growthSeries(env, 'referral', 30);
  /* The top of the funnel. Everything else here starts at signup, so the
     largest group - people who looked and left - was invisible, and
     visitors-to-accounts is the number most marketing work is trying to move. */
  const visits30 = await _growthSeries(env, 'visit', 30);
  const visits7 = visits30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signupsToday = signups30.length ? signups30[signups30.length - 1].count : 0;
  const activeToday = active30.length ? active30[active30.length - 1].count : 0;
  const referrals7 = referrals30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signups7 = signups30.slice(-7).reduce((n, d) => n + d.count, 0);
  const signupsPrev7 = signups30.slice(-14, -7).reduce((n, d) => n + d.count, 0);
  const wowGrowthPct = signupsPrev7 > 0 ? +(((signups7 - signupsPrev7) / signupsPrev7) * 100).toFixed(0) : null;

  /* EVERY account, not every entitlement row.

     This read `entRows.length`, and a free signup creates no entitlement row -
     so the denominator was essentially the set of people who had already paid,
     and conversion reported ~100% no matter what the funnel was really doing.
     On a fixture of twenty free accounts and one payer it said 100% where the
     truth was 4.8%: the single most decision-corrupting number the dashboard
     could produce, because it says the funnel is perfect and there is nothing
     to fix.

     The maintained counter is exact at any size. It falls back to the scan on
     a deployment that predates it, where the old wrong answer is still better
     than none - and `basis` says which one this is, because a number whose
     meaning changes silently is how the first version of this got believed. */
  const popAccounts = await _tallyGet(env, 'popaccounts');
  const countedAccounts = popAccounts > 0 ? popAccounts : entRows.length;
  const conversionBasis = popAccounts > 0 ? 'accounts' : 'entitlements';
  const conversionPct = countedAccounts > 0 ? +((paying / countedAccounts) * 100).toFixed(1) : 0;
  const arpu = paying > 0 ? +(mrr / paying).toFixed(2) : 0;
  const appRequests = await _appRequestCounts(env);

  return json({
    ok: true,
    generatedAt: Date.now(),
    /* Which apps people pressed Notify me on, most asked-for first. The
       Integrations page promises the most-asked-for are connected next; this
       is the list that promise is kept from. */
    appRequests,
    spend: { today: +gSpend.toFixed(2), cap: gCap, pctOfCap: +(gSpend / gCap * 100).toFixed(1), killed },
    outcomes,
    slo: await _sloReport(env, month).catch(() => []),
    users: { total: truncated ? popTotal : users.length, paying, byPlan: plans,
             conversionPct, conversionBasis, accounts: countedAccounts, activeToday },
    /* Say plainly whether the per-account lists below are everything or a
       sample. The alternative is a number that is quietly wrong. */
    scan: { rows: entRows.length, limit: SCAN_LIMIT, truncated,
            note: truncated
              ? 'More accounts than one page can read. Revenue and population come from maintained counters and are exact; the per-account lists are the first ' + entRows.length + '.'
              : 'Every account was read.' },
    growth: { signupsToday, signups7, signupsPrev7, wowGrowthPct, signups30, active30,
              referrals7, referrals30, visits7, visits30,
              /* Of the people who arrived, how many became accounts. Null
                 rather than 0 when nothing has been counted yet, because "no
                 visitors recorded" and "nobody converted" are different facts
                 and showing 0% for the first is a lie about the product. */
              visitToSignupPct: visits7 > 0 ? +((signups7 / visits7) * 100).toFixed(1) : null,
              // What share of the last week's signups came through an invite.
              referralSharePct: signups7 > 0 ? +((referrals7 / signups7) * 100).toFixed(1) : null },
    /* Signup -> activated -> returned -> paid. The question every piece of
       onboarding work is trying to move, and the only one that says whether it
       did (AMV-101). */
    funnel: await _funnelReport(env),
    retention: await _retentionReport(env).catch(() => null),
    revenue: { estMRR: mrr, estARR: mrr * 12, arpu, pastDueAccounts: pastDue, mrrAtRisk: atRisk,
               teamSeatsSold: seatsSold, teamSeatMRR: seatsSold * TEAM_SEAT_PRICE_USD },
    margin: (() => {
      const scanCost = +users.reduce((s, u) => s + u.monthCostUSD, 0).toFixed(2);
      /* The maintained total is exact; the scanned sum is only exact when the
         scan saw everything. Prefer the counter, and fall back to the sum if it
         has not been populated yet (an existing deployment before this shipped). */
      const totalCost = +(totalCost0 > 0 ? totalCost0 : scanCost).toFixed(2);
      return {
        estMonthlyCost: totalCost,
        grossMargin: +(mrr - totalCost).toFixed(2),
        grossMarginPct: mrr > 0 ? +(((mrr - totalCost) / mrr) * 100).toFixed(1) : null,
        costPerPayingUser: paying > 0 ? +(totalCost / paying).toFixed(3) : 0,
        freeUserCost: freeCost,
        byPlan: byPlanEconomics,
        featureCost,
        cacheSavedUSD: cacheSaved,
        unprofitableAccounts: unprofitable,
      };
    })(),
    quality,
    speed,
    /* Actions on people's accounts this month, by what AMV could confirm -
       the measure of work actually done, not of messages sent. */
    actionOutcomes: await _actOutcomes(env, month),
    topSpenders,
  });
}

