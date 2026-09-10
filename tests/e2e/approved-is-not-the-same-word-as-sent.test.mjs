/* "SENT" IS A CLAIM ABOUT THE WORLD, AND IT WAS BEING MADE ON NOTHING.

   `crewApprovalAct` answers `{found:false, delivered:null}` for any approval
   the server does not hold - and it holds only the ones its own cron enqueued.
   Every card `_recurMakeApproval` builds lives in the browser's storage and has
   never been near the server, so `found:false` is the NORMAL answer for a job
   that only runs while AMV is open.

   `delivered` is null in that answer, not false, so the guard written for "no
   email provider" did not catch it. Approving fell through to `toast('Sent')`
   and to deleting the draft. The person was told their email had gone out, the
   draft was gone, and nothing had been sent to anybody.

   The comment above `_apvDoApprove` already says what this is: "An email that
   was never sent, reported as sent, is the kind of mistake somebody loses a
   client over." It was fixed for a failed request and for a missing provider.
   This third road to the same place stayed open, and it was the one the
   default path took.

   So this suite drives every answer the server can give and asserts on two
   things each time: the WORD the person is told, and whether the draft still
   exists. Losing the draft while claiming success is worse than either failure
   on its own - it removes the evidence that anything went wrong. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' }, tab: 'crew' });
const { page, errors } = app;

/* One approval, one server answer, driven through the real approve path. */
const approve = (answer, card) => page.evaluate(([ans, c]) => {
  AMV_API.base = 'https://backend.test'; AMV_API.token = 't';
  const msgs = [];
  window.toast = (m, kind) => msgs.push({ m: String(m), kind });
  AMV_API.actApproval = async () => { if(ans.__throw) throw new Error(ans.__throw); return ans; };
  const item = Object.assign({
    id: 'a1', title: 'Weekly note', actionType: 'send', resultType: 'email',
    destination: 'jane@school.org', recipients: 1,
    result: { type: 'email', to: 'jane@school.org', subject: 'Weekly note', body: 'hello' },
  }, c || {});
  store('amv_cw_approvals', [item]);
  return _apvDoApprove(item).then(out => ({
    out, msgs, left: (load('amv_cw_approvals') || []).length,
  }));
}, [answer, card || {}]);

section('A draft the server does not have was NOT sent');
{
  const r = await approve({ ok: true, action: 'approve', found: false, delivered: null });
  ok(!r.msgs.some(m => /^Sent$/i.test(m.m)),
     'it does not say "Sent" about a send that did not happen', r.msgs);
  ok(r.msgs.some(m => m.kind === 'error' && /NOT sent/i.test(m.m)),
     'it says plainly that nothing was sent', r.msgs);
  ok(r.left === 1,
     'and the draft is still there - deleting it would destroy the evidence and the work', r.left);
  ok(r.out && r.out.delivered === false,
     'and the caller is told delivered:false rather than a hopeful null', r.out);
}

section('The same answer on a review-only card is a genuine resolution');
{
  /* The fix must not turn every local card into a failure. A card nobody is
     sending is finished by being read, and the server having no copy of it
     changes nothing about that. */
  const r = await approve({ ok: true, action: 'approve', found: false, delivered: null },
                          { actionType: 'review', resultType: 'doc', destination: '', recipients: null });
  ok(r.out && r.out.ok === true, 'it resolves', r.out);
  ok(r.left === 0, 'and leaves the queue, because there was nothing to deliver', r.left);
  ok(!r.msgs.some(m => m.kind === 'error'), 'with no failure claimed either', r.msgs);
}

section('A send the server really made is still reported as sent');
{
  const r = await approve({ ok: true, action: 'approve', found: true, delivered: true });
  ok(r.msgs.some(m => /^Sent$/i.test(m.m)), 'the working case still says Sent', r.msgs);
  ok(r.left === 0, 'and the draft leaves the queue', r.left);
}

section('Approved with no provider behind it is a different word from sent');
{
  const r = await approve({ ok: true, action: 'approve', found: true, delivered: false });
  ok(r.msgs.some(m => /not emailed/i.test(m.m)), 'it says approved but not emailed', r.msgs);
  ok(!r.msgs.some(m => /^Sent$/i.test(m.m)), 'and never the word Sent', r.msgs);
}

section('A second press is told the truth about the first');
{
  const r = await approve({ ok: true, action: 'approve', found: true, delivered: null, duplicate: true });
  ok(r.msgs.some(m => /already going out/i.test(m.m)),
     'a duplicate is reassurance, not a second send', r.msgs);
}

section('A request that failed keeps the draft');
{
  const r = await approve({ __throw: 'network down' });
  ok(r.left === 1, 'the draft survives a failed request', r.left);
  ok(r.msgs.some(m => m.kind === 'error' && /NOT/i.test(m.m)), 'and the failure is said out loud', r.msgs);
}

section('Every answer was distinguishable from every other');
{
  /* The defect was two different outcomes producing one word. Guarding the
     specific case is not enough - what must hold is that no two of these
     answers leave the person believing the same thing. */
  const words = [];
  for(const ans of [
    { ok: true, found: false, delivered: null },
    { ok: true, found: true, delivered: true },
    { ok: true, found: true, delivered: false },
  ]){
    const r = await approve(ans);
    words.push(r.msgs.map(m => m.m).join(' | '));
  }
  const uniq = new Set(words);
  ok(uniq.size === words.length,
     'three different things that happened are described three different ways', words);
}

ok(errors.length === 0, 'and none of it threw', errors);
report(); done(app);
