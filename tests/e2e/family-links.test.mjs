/* LINKED ACCOUNTS SECURITY — "let one account control another" is an
   account-takeover feature if built casually. These assertions prove consent
   is real: naming an email grants nothing, only the account being accessed can
   approve, codes expire and burn out, scopes are honoured, either side can
   revoke, and every cross-account action is logged for both sides. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Parent', email: 'parent@x.com', ini: 'P' } });
const { page, errors } = app;

const asUser = (email) => page.evaluate((e) => { S.user = { name: e, email: e, ini: 'X' }; }, email);
const reset = () => page.evaluate(() => { try { store('amv_links', { links: [], invites: [] }); } catch (e) {} });

section('An invite grants nothing on its own');
await reset();
const inv = await page.evaluate(() => {
  const F = window.AMVFamily;
  const r = F.invite('child@x.com', ['calendar_view', 'calendar_edit'], { label: 'School' });
  return { id: r.id, owner: r.owner, scopes: r.scopes, delivery: r.delivery,
    accessNow: F.check('child@x.com', 'calendar_view'), mine: F.mine() };
});
ok(!!inv.id, 'an invite can be created', inv.owner);
ok(typeof inv.accessNow === 'string' && /approve/i.test(inv.accessNow),
  'BEFORE approval the parent has NO access - naming an email grants nothing', inv.accessNow);
ok(inv.mine.iCanAccess.length === 0, 'and no link exists yet');
ok(inv.delivery.to === 'child@x.com', 'the confirmation code goes to the account being accessed, not the requester');

section('Only the account being accessed can approve');
const wrongApprover = await page.evaluate((id) => {
  try { window.AMVFamily.accept(id, '000000'); return 'ACCEPTED'; }
  catch (e) { return e.message; }
}, inv.id);
ok(/Only child@x\.com can approve/i.test(wrongApprover),
  'the REQUESTER cannot approve their own request', wrongApprover);

section('A wrong code is rejected, and repeated guessing burns the invite');
await asUser('child@x.com');
const guesses = await page.evaluate((id) => {
  const F = window.AMVFamily; const out = [];
  for (let i = 0; i < 6; i++) { try { F.accept(id, '111111'); out.push('ACCEPTED'); } catch (e) { out.push(e.message); } }
  return out;
}, inv.id);
ok(guesses.every(g => g !== 'ACCEPTED'), 'no wrong code is ever accepted', guesses[0]);
ok(/attempts left/i.test(guesses[0]), 'attempts are counted', guesses[0]);
ok(guesses.some(g => /Too many wrong codes/i.test(g)), 'brute forcing kills the invitation', guesses);
ok(/blocked/i.test(guesses[guesses.length - 1]), 'and every later attempt is refused as blocked', guesses[guesses.length - 1]);

section('The correct code, from the right account, creates the link');
await reset();
await asUser('parent@x.com');
const flow = await page.evaluate(() => {
  const F = window.AMVFamily;
  F.invite('child@x.com', ['calendar_view'], {});
  const d = load('amv_links');
  const invite = d.invites[0];
  S.user = { name: 'Child', email: 'child@x.com', ini: 'C' };   // now the owner
  const link = F.accept(invite.id, invite.code);
  S.user = { name: 'Parent', email: 'parent@x.com', ini: 'P' };
  return {
    linked: !!link,
    viewAllowed: F.check('child@x.com', 'calendar_view'),
    editRefused: F.check('child@x.com', 'calendar_edit'),
    emailRefused: F.check('child@x.com', 'email_view')
  };
});
ok(flow.linked, 'the link is created only after the owner enters their own code');
ok(flow.viewAllowed === null, 'the granted scope is now allowed', flow.viewAllowed);

section('Scopes are honoured - nothing is granted that was not ticked');
ok(typeof flow.editRefused === 'string' && /does not include/i.test(flow.editRefused),
  'a scope that was NOT granted is refused', flow.editRefused);
ok(typeof flow.emailRefused === 'string', 'an unrelated scope (email) is refused too', flow.emailRefused);

section('Links are one-directional - access is never reciprocal');
const reverse = await page.evaluate(() => {
  S.user = { name: 'Child', email: 'child@x.com', ini: 'C' };
  const r = window.AMVFamily.check('parent@x.com', 'calendar_view');
  S.user = { name: 'Parent', email: 'parent@x.com', ini: 'P' };
  return r;
});
ok(typeof reverse === 'string', 'the child does NOT get access to the parent in return', reverse);

section('Either side can revoke instantly, and access dies with it');
const rev = await page.evaluate(() => {
  const F = window.AMVFamily;
  S.user = { name: 'Child', email: 'child@x.com', ini: 'C' };   // the OWNER revokes
  const id = load('amv_links').links[0].id;
  const r = F.revoke(id);
  S.user = { name: 'Parent', email: 'parent@x.com', ini: 'P' };
  return { revoked: r.revoked, afterCheck: F.check('child@x.com', 'calendar_view'), mine: F.mine() };
});
ok(rev.revoked === true, 'the account owner can revoke without the other side agreeing');
ok(typeof rev.afterCheck === 'string', 'access is refused immediately after revocation', rev.afterCheck);
ok(rev.mine.iCanAccess.length === 0, 'and the link disappears from active access');

section('Every cross-account action is visible to both sides');
const logged = await page.evaluate(() => {
  const F = window.AMVFamily;
  store('amv_links', { links: [], invites: [] });
  F.invite('child@x.com', ['calendar_view'], {});
  const invite = load('amv_links').invites[0];
  S.user = { name: 'Child', email: 'child@x.com', ini: 'C' };
  F.accept(invite.id, invite.code);
  S.user = { name: 'Parent', email: 'parent@x.com', ini: 'P' };
  F.note('child@x.com', 'calendar_view', 'Viewed the week of the 3rd');
  const id = load('amv_links').links[0].id;
  const asParent = F.history(id);
  S.user = { name: 'Child', email: 'child@x.com', ini: 'C' };
  const asChild = F.history(id);
  S.user = { name: 'Parent', email: 'parent@x.com', ini: 'P' };
  return { asParent: asParent.length, asChild: asChild.length, what: asChild[0] && asChild[0].what };
});
ok(logged.asParent === 1 && logged.asChild === 1, 'the action is in both sides’ history', logged);
ok(/Viewed the week/.test(logged.what || ''), 'with what was actually done', logged.what);

section('Bad input is refused');
const bad = await page.evaluate(() => {
  const F = window.AMVFamily; const out = {};
  try { F.invite('not-an-email', ['calendar_view']); } catch (e) { out.badEmail = e.message; }
  try { F.invite('parent@x.com', ['calendar_view']); } catch (e) { out.self = e.message; }
  try { F.invite('someone@x.com', []); } catch (e) { out.noScopes = e.message; }
  try { F.invite('someone@x.com', ['not_a_scope']); } catch (e) { out.badScope = e.message; }
  out.unknownScopeCheck = F.check('someone@x.com', 'made_up');
  return out;
});
ok(/valid email/i.test(bad.badEmail || ''), 'a malformed email is refused');
ok(/your own account/i.test(bad.self || ''), 'you cannot link to yourself');
ok(/at least one/i.test(bad.noScopes || ''), 'a link with no permissions is refused');
ok(/at least one/i.test(bad.badScope || ''), 'an invented scope is not silently accepted');
ok(/Unknown permission/i.test(bad.unknownScopeCheck || ''), 'checking an unknown permission denies by default');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
