/* JOB HUNT ENGINE — the deterministic decision core. Proves the honest rules:
   ask when the user hasn't specified something the posting needs, apply when
   everything's provided and the channel is submittable, and NEVER claim to have
   submitted a portal job AMV can't actually submit. See JOBS.md. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

const r = await page.evaluate(() => {
  const J = window.AMVJobs;
  if (!J) return { missing: true };
  const complete = {
    mode: 'auto', resumes: [{ id: 'r1', text: 'x' }],
    contact: { name: 'Alex', email: 'alex@x.com' },
    targets: { roles: ['Engineer'], locations: [], remote: 'any', salaryMin: 0 },
    prefs: { authorization: 'citizen', start: 'now', hours: 'full-time' }
  };
  const emailJob = { applyEmail: 'jobs@co.com', asks: [] };
  const portalJob = { applyUrl: 'https://co.com/apply', asks: [] };
  const asksJob = { applyEmail: 'jobs@co.com', asks: [{ key: 'why', q: 'Why do you want this role?' }] };
  return {
    missing: false,
    chEmail: J.channelFor(emailJob),
    chPortal: J.channelFor(portalJob),
    chNone: J.channelFor({}),
    missEmpty: J.missingInfo(emailJob, {}).map(m => m.key),
    missComplete: J.missingInfo(emailJob, complete).length,
    outAutoEmail: J.applyOutcome(emailJob, complete, 'auto').action,
    outAutoPortal: J.applyOutcome(portalJob, complete, 'auto').action,
    outAsk: J.applyOutcome(emailJob, complete, 'ask').action,
    outNeedsInfo: J.applyOutcome(asksJob, complete, 'auto'),
    rep: J.buildReport({ outcomes: [
      { outcome: { action: 'applied_email' } },
      { outcome: { action: 'ready_portal' } },
      { outcome: { action: 'needs_info', questions: [{ q: 'Q1' }] } }
    ] })
  };
});
ok(!r.missing, 'AMVJobs engine is exposed');

section('Apply channel is classified honestly');
ok(r.chEmail === 'email', 'a job with an application email -> email channel', r.chEmail);
ok(r.chPortal === 'portal', 'a job with only a portal URL -> portal channel', r.chPortal);
ok(r.chNone === 'unknown', 'neither -> unknown', r.chNone);

section('Missing-info detection drives ask-vs-apply');
ok(['resume', 'name', 'email', 'roles'].every(k => r.missEmpty.includes(k)), 'an empty profile is missing the base requirements', r.missEmpty);
ok(r.missComplete === 0, 'a complete profile is missing nothing');

section('The decision engine (the core UX rule)');
ok(r.outAutoEmail === 'applied_email', 'complete + autonomous + email -> AMV applies', r.outAutoEmail);
ok(r.outAutoPortal === 'ready_portal', 'complete + autonomous + PORTAL -> ready-to-submit, NOT a fake "applied"', r.outAutoPortal);
ok(r.outAutoPortal !== 'applied_email', 'AMV never claims to submit a portal job it cannot submit');
ok(r.outAsk === 'queued_approval', 'ask-first mode always queues for approval', r.outAsk);
ok(r.outNeedsInfo.action === 'needs_info', 'a posting asking something unspecified -> AMV asks first', r.outNeedsInfo.action);
ok((r.outNeedsInfo.questions || []).some(q => /why/i.test(q.q)), 'and the question is the exact unanswered field');

section('Morning report tallies outcomes');
ok(r.rep.applied === 1 && r.rep.readyToSubmit === 1 && r.rep.needsInfo === 1, 'report counts applied / ready / needs-info correctly', r.rep);
ok(r.rep.questions.length === 1, 'report surfaces the questions to answer');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
