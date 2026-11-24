/* ONE ADDRESS CANNOT FLOOD AMV - STOPPED AT CLOUDFLARE'S EDGE, BEFORE THE WORKER.

   Owner, Nov 24 ("do anything you recommend"). Nothing at the edge limited
   how often one address could call AMV, so on Workers Free one script could
   spend the day's 100,000 requests for everybody. A limit inside the Worker
   does not help with that: the request has already been counted by the time
   the Worker sees it. A Cloudflare rate limiting rule runs before the Worker,
   and Free includes one.

   What this does, in order, and nothing else:
     1. finds the zone by name;
     2. reads the zone's rate limiting rules (phase http_ratelimit) - a write
        REPLACES the whole list, so every rule already there is kept as it is;
     3. adds AMV's rule, or replaces the one it added before (ref amv_flood_guard);
     4. reads the rules back and says it worked ONLY if AMV's rule came back
        exactly as sent. Cloudflare's own refusal is printed word for word.

   Generous on purpose: 150 requests per 10 seconds from one address (at one
   Cloudflare location), then that address waits 10 seconds. A school or an
   office shares one address, and locking a classroom out is worse than the
   flood. It stops one machine hammering; it does not stop a distributed
   attack, which is what Workers Paid (no daily cap) or a stricter plan is for.

   Usage (the edge-rate-limit workflow runs this):
     CF_TOKEN=... ZONE=amv.homes [LIMIT=150] [EXPRESSION=...] [DRY=1] node scripts/edge-rate-limit.mjs */

export const REF = 'amv_flood_guard';
export const DEFAULTS = { limit: 150, period: 10, timeout: 10, expression: '(http.request.uri.path wildcard "/*")' };

export function ourRule(o = {}) {
  const limit = Number(o.limit) || DEFAULTS.limit;
  return {
    ref: REF,
    description: 'AMV: one address sending more than ' + limit + ' requests in 10 seconds waits 10 seconds',
    expression: o.expression || DEFAULTS.expression,
    action: 'block',
    ratelimit: { characteristics: ['cf.colo.id', 'ip.src'], period: DEFAULTS.period,
                 requests_per_period: limit, mitigation_timeout: DEFAULTS.timeout },
    enabled: true,
  };
}

/* The fields a rule is written with; what Cloudflare adds on read (version,
   last_updated) is not sent back. */
const KEEP = ['id', 'ref', 'description', 'expression', 'action', 'action_parameters', 'ratelimit', 'enabled', 'logging'];
const pick = (r) => Object.fromEntries(KEEP.filter(k => r[k] !== undefined).map(k => [k, r[k]]));

export function sameRule(got, want) {
  if (!got) return false;
  const a = got.ratelimit || {}, b = want.ratelimit;
  return got.expression === want.expression && got.action === want.action && got.enabled !== false
    && a.period === b.period && a.requests_per_period === b.requests_per_period
    && a.mitigation_timeout === b.mitigation_timeout
    && JSON.stringify([...(a.characteristics || [])].sort()) === JSON.stringify([...b.characteristics].sort());
}

const why = (j, status) => {
  const errs = (j && j.errors) || [];
  const said = errs.map(e => (e.code ? e.code + ': ' : '') + (e.message || '')).join('; ') || ('HTTP ' + status);
  const perm = errs.some(e => e.code === 10000 || /auth|permission/i.test(e.message || '')) || status === 403;
  return perm ? said + ' - the CLOUDFLARE_API_TOKEN needs "Zone > Zone > Read" and "Zone > Zone WAF > Edit" for this zone.' : said;
};

/* Returns { ok, said, kept, rule }. Never throws for an answer Cloudflare gave. */
export async function apply({ token, zone, limit, expression, dry, fetchImpl }) {
  const f = fetchImpl || fetch;
  const api = async (path, init = {}) => {
    const r = await f('https://api.cloudflare.com/client/v4' + path, Object.assign({}, init, {
      headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, init.headers || {}) }));
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, ok: r.ok && !!(j && j.success !== false), j };
  };
  if (!token) return { ok: false, said: 'No CLOUDFLARE_API_TOKEN, so nothing was changed.' };
  const z = await api('/zones?name=' + encodeURIComponent(zone));
  const zid = z.ok && z.j.result && z.j.result[0] && z.j.result[0].id;
  if (!zid) return { ok: false, said: 'Could not find the zone ' + zone + ': ' + (z.ok ? 'no such zone on this account' : why(z.j, z.status)) };

  const path = '/zones/' + zid + '/rulesets/phases/http_ratelimit/entrypoint';
  const cur = await api(path);
  let rules = [];
  if (cur.ok) rules = (cur.j.result && cur.j.result.rules) || [];
  else if (cur.status !== 404) return { ok: false, said: 'Could not read the current rate limiting rules: ' + why(cur.j, cur.status) };

  const kept = rules.filter(r => r.ref !== REF).map(pick);
  const rule = ourRule({ limit, expression });
  if (dry) return { ok: true, dry: true, said: 'Dry run: would keep ' + kept.length + ' rule(s) and set AMV’s.', kept, rule };

  const put = await api(path, { method: 'PUT', body: JSON.stringify({ rules: kept.concat(rule) }) });
  if (!put.ok) return { ok: false, said: 'Cloudflare refused the rule: ' + why(put.j, put.status), kept, rule };

  const back = await api(path);
  const got = back.ok ? ((back.j.result && back.j.result.rules) || []) : [];
  const ours = got.find(r => r.ref === REF);
  const stillThere = kept.every(k => got.some(g => (k.id && g.id === k.id) || (k.ref && g.ref === k.ref)));
  if (!sameRule(ours, rule)) return { ok: false, said: 'Written, but reading it back did not show AMV’s rule as sent - not claiming it is on.', kept, rule };
  if (!stillThere) return { ok: false, said: 'AMV’s rule is on, but a rule that was already there did not come back. Check the zone’s rate limiting rules.', kept, rule };
  return { ok: true, said: 'On: more than ' + rule.ratelimit.requests_per_period + ' requests in 10 seconds from one address waits 10 seconds. ' + kept.length + ' other rule(s) kept.', kept, rule };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const out = await apply({ token: process.env.CF_TOKEN, zone: process.env.ZONE || 'amv.homes',
    limit: process.env.LIMIT, expression: process.env.EXPRESSION || '', dry: process.env.DRY === '1' });
  console.log(out.said);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Edge flood guard\n\n' + (out.ok ? '' : '**Not on.** ') + out.said + '\n');
  }
  process.exit(out.ok ? 0 : 1);
}
