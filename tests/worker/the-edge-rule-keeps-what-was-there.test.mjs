/* THE EDGE RULE KEEPS WHAT WAS THERE, AND IS ONLY "ON" WHEN IT READS BACK.

   scripts/edge-rate-limit.mjs writes AMV's flood guard into the zone's rate
   limiting rules. Cloudflare's write REPLACES the whole list, so the danger
   is deleting a rule somebody set by hand; and the claim worth making is
   "on", which only a read-back can support. Against a stand-in Cloudflare:
     - a rule already there survives, untouched;
     - running it twice leaves one AMV rule, not two;
     - a refusal is reported in Cloudflare's words, with the permission named;
     - a write that does not read back as sent is not reported as on;
     - a dry run changes nothing. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { apply, REF, ourRule } from '../../scripts/edge-rate-limit.mjs';

function cloud(opts = {}) {
  const st = { rules: (opts.rules || []).map(r => Object.assign({}, r)), puts: 0, exists: opts.exists !== false };
  const send = (j, s = 200) => new Response(JSON.stringify(j), { status: s });
  st.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    if (/\/zones\?name=/.test(u)) return opts.noZone ? send({ success: true, result: [] }) : send({ success: true, result: [{ id: 'z1' }] });
    if (/\/rulesets\/phases\/http_ratelimit\/entrypoint$/.test(u)) {
      if (m === 'GET') return st.exists ? send({ success: true, result: { rules: st.rules } }) : send({ success: false, errors: [{ code: 10003, message: 'not found' }] }, 404);
      if (m === 'PUT') {
        st.puts++;
        if (opts.refuse) return send({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
        const body = JSON.parse(init.body); st.lastBody = body;
        st.rules = body.rules.map((r, i) => Object.assign({ id: r.id || 'new' + i, version: '1', last_updated: 'now' }, r,
          opts.mangle && r.ref === REF ? { ratelimit: Object.assign({}, r.ratelimit, { requests_per_period: 1 }) } : {}));
        st.exists = true;
        return send({ success: true, result: { rules: st.rules } });
      }
    }
    return send({ success: false, errors: [{ message: 'unexpected ' + m + ' ' + u }] }, 400);
  };
  return st;
}
const base = { token: 't', zone: 'amv.test' };
const theirs = { id: 'r_hand', version: '3', last_updated: '2026-01-01T00:00:00Z', ref: 'owner_login_guard', description: 'set by hand', expression: '(http.request.uri.path eq "/login")',
  action: 'block', ratelimit: { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 5, mitigation_timeout: 10 }, enabled: true };

section('A rule set by hand survives, and AMV’s is on');
{
  const c = cloud({ rules: [theirs] });
  const r = await apply(Object.assign({ fetchImpl: c.fetch }, base));
  ok(r.ok, 'reported on', r.said);
  ok(c.rules.some(x => x.id === 'r_hand' && x.ratelimit.requests_per_period === 5 && x.expression === theirs.expression), 'the rule that was there is still there, unchanged', c.rules);
  ok(c.rules.filter(x => x.ref === REF).length === 1, 'with AMV’s beside it', c.rules.map(x => x.ref));
  ok(c.lastBody.rules.every(x => !('version' in x) && !('last_updated' in x)), 'and only writable fields were sent back', c.lastBody.rules);
}

section('Running it again does not add a second');
{
  const c = cloud({ rules: [theirs] });
  await apply(Object.assign({ fetchImpl: c.fetch }, base));
  const r = await apply(Object.assign({ fetchImpl: c.fetch, limit: 200 }, base));
  const ours = c.rules.filter(x => x.ref === REF);
  ok(r.ok && ours.length === 1 && ours[0].ratelimit.requests_per_period === 200, 'one AMV rule, now at the new limit', ours);
}

section('No rules yet is fine');
{
  const c = cloud({ exists: false });
  const r = await apply(Object.assign({ fetchImpl: c.fetch }, base));
  ok(r.ok && c.rules.length === 1 && c.rules[0].ref === REF, 'the list is created with AMV’s rule', c.rules);
}

section('A refusal is said in Cloudflare’s words, with what to fix');
{
  const c = cloud({ rules: [theirs], refuse: true });
  const r = await apply(Object.assign({ fetchImpl: c.fetch }, base));
  ok(!r.ok && /Authentication error/.test(r.said) && /Zone WAF > Edit/.test(r.said), 'not on, and why', r.said);
  ok(c.rules.length === 1 && c.rules[0].id === 'r_hand', 'and nothing was lost', c.rules);
}

section('Written but not as sent is not "on"');
{
  const c = cloud({ mangle: true });
  const r = await apply(Object.assign({ fetchImpl: c.fetch }, base));
  ok(!r.ok && /reading it back/.test(r.said), 'the read-back decides', r.said);
}

section('A dry run and a missing zone change nothing');
{
  const c = cloud({ rules: [theirs] });
  const r = await apply(Object.assign({ fetchImpl: c.fetch, dry: true }, base));
  ok(r.ok && r.dry && c.puts === 0, 'dry: read, reported, not written', [r.said, c.puts]);
  const c2 = cloud({ noZone: true });
  const r2 = await apply(Object.assign({ fetchImpl: c2.fetch }, base));
  ok(!r2.ok && c2.puts === 0 && /zone/.test(r2.said), 'unknown zone: says so', r2.said);
  const r3 = await apply({ zone: 'amv.test', fetchImpl: c.fetch });
  ok(!r3.ok && /No CLOUDFLARE_API_TOKEN/.test(r3.said), 'no token: says so', r3.said);
}

section('Generous enough for a classroom on one address');
{
  const r = ourRule();
  ok(r.ratelimit.requests_per_period >= 100 && r.ratelimit.period === 10 && r.ratelimit.mitigation_timeout === 10 && r.action === 'block',
     'at least 100 requests in 10 seconds before a 10-second wait', r.ratelimit);
}

report();
done();
