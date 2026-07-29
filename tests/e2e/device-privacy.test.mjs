/* DEVICE PRIVACY — AMV keeps your work on the device so signing back in
   restores it. That is right for a personal machine and wrong for a shared
   one: a school library or family laptop would otherwise leave the next
   person your chats, memories and uploaded resume. These assertions cover
   both halves: accounts never see each other's data, and there is a real
   erase for when the computer is not yours. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

section('One account can never read another account’s data');
const iso = await page.evaluate(() => {
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  S.memory = [{ id: 'm1', text: 'ALICE_SECRET_MEMORY', added: Date.now() }]; store('amv_memory', S.memory);
  S.convs = [{ id: 'c1', title: 'ALICE_SECRET_CHAT', msgs: [{ r: 'u', c: 'private' }] }]; store('amv_convs', S.convs);
  AMVJobs.save(Object.assign(AMVJobs.cfg(), { resumes: [{ id: 'r', text: 'ALICE_RESUME' }] }));
  AMVSpend.save(Object.assign(AMVSpend.cfg(), { enabled: true, spent: 123 }));
  AMVCompliance.accept(); AMVCompliance.setBirthYear(1990);

  // Bob signs in on the same device
  S.user = { name: 'Bob', email: 'bob@x.com', ini: 'B' };
  return {
    memory: JSON.stringify(load('amv_memory') || []).includes('ALICE_SECRET_MEMORY'),
    chats: JSON.stringify(load('amv_convs') || []).includes('ALICE_SECRET_CHAT'),
    resume: JSON.stringify(AMVJobs.cfg()).includes('ALICE_RESUME'),
    spend: AMVSpend.cfg().spent === 123,
    age: AMVCompliance.ageKnown(),
    consent: AMVCompliance.accepted()
  };
});
ok(iso.memory === false, 'memories do not cross accounts');
ok(iso.chats === false, 'conversations do not cross accounts');
ok(iso.resume === false, 'an uploaded resume does not cross accounts');
ok(iso.spend === false, 'spending history does not cross accounts');
ok(iso.age === false, 'age is NOT inherited - a minor cannot pick up an adult’s verification', iso.age);
ok(iso.consent === false, 'accepted terms are not inherited either', iso.consent);

section('Ordinary sign-out keeps your work (personal device)');
const kept = await page.evaluate(() => {
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  store('amv_memory', [{ id: 'm', text: 'KEEP_ME', added: 1 }]);
  signOut();
  // signing back in must restore it
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  return JSON.stringify(load('amv_memory') || []).includes('KEEP_ME');
});
ok(kept === true, 'signing out and back in restores your data on your own device');

section('Sign out AND erase leaves nothing behind (shared device)');
const erased = await page.evaluate(() => {
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  store('amv_memory', [{ id: 'm', text: 'ALICE_SECRET' }]);
  store('amv_convs', [{ id: 'c', title: 'ALICE_CHAT', msgs: [{ r: 'u', c: 'x' }] }]);
  AMVJobs.save(Object.assign(AMVJobs.cfg(), { resumes: [{ id: 'r', text: 'ALICE_RESUME_PII' }] }));
  saveStr('amv_gtoken', 'GTOKEN'); saveStr('amv_api_token', 'APITOKEN');

  const leakBefore = Object.keys(localStorage).some(k => /ALICE_RESUME_PII|ALICE_SECRET|ALICE_CHAT/.test(localStorage.getItem(k) || ''));
  const removed = eraseDeviceData('alice@x.com');
  const scopedLeft = Object.keys(localStorage).filter(k => k.indexOf('u:alice@x.com|') === 0).length;
  const leakAfter = Object.keys(localStorage).some(k => /ALICE_RESUME_PII|ALICE_SECRET|ALICE_CHAT/.test(localStorage.getItem(k) || ''));
  return { leakBefore, removed, scopedLeft, leakAfter,
    tokensGone: !localStorage.getItem('amv_gtoken') && !localStorage.getItem('amv_api_token') };
});
ok(erased.leakBefore === true, 'the data really was on the device to begin with (test is meaningful)');
ok(erased.removed > 0, 'the erase removes items', erased.removed);
ok(erased.scopedLeft === 0, 'no account-scoped key survives', erased.scopedLeft);
ok(erased.leakAfter === false, 'the resume, chats and memories are genuinely gone', erased.leakAfter);
ok(erased.tokensGone === true, 'connection tokens are cleared too, so nothing can be replayed');

section('Erasing this device does not damage the other account on it');
const collateral = await page.evaluate(() => {
  localStorage.clear();
  // Bob has been using this family laptop too
  S.user = { name: 'Bob', email: 'bob@x.com', ini: 'B' };
  store('amv_memory', [{ id: 'b', text: 'BOB_MEMORY' }]);
  saveStr('amv_links', JSON.stringify({
    links: [{ id: 'l1', owner: 'alice@x.com', grantee: 'mum@x.com', active: true },
            { id: 'l2', owner: 'bob@x.com', grantee: 'mum@x.com', active: true }],
    invites: []
  }));
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  store('amv_memory', [{ id: 'a', text: 'ALICE_MEMORY' }]);
  eraseDeviceData('alice@x.com');

  const links = JSON.parse(localStorage.getItem('amv_links') || '{"links":[]}').links;
  S.user = { name: 'Bob', email: 'bob@x.com', ini: 'B' };
  return {
    bobKept: JSON.stringify(load('amv_memory') || []).includes('BOB_MEMORY'),
    aliceLink: links.some(l => l.owner === 'alice@x.com'),
    bobLink: links.some(l => l.owner === 'bob@x.com')
  };
});
ok(collateral.bobKept === true, 'the other account on the device keeps its own work');
ok(collateral.aliceLink === false, 'the erased account’s family links are pruned');
ok(collateral.bobLink === true, 'but the other account’s links survive - no collateral damage');

section('Deleting an account is scoped too, and never uses localStorage.clear()');
const delScoped = await page.evaluate(() => ({
  clears: /localStorage\.clear\(\)/.test(String(window._confirmDeleteAccount)),
  scoped: /eraseDeviceData\(/.test(String(window._confirmDeleteAccount)),
  typed: /DELETE/.test(String(window._confirmDeleteAccount))
}));
ok(delScoped.clears === false, 'deletion does not blank the whole browser (a sibling’s data would go with it)');
ok(delScoped.scoped === true, 'it erases only the account being deleted');
ok(delScoped.typed === true, 'and it still requires typing DELETE, because it is irreversible');

section('All three exits are offered, and told apart');
const wired = await page.evaluate(() => {
  showProfMenu(document.body);
  const txt = id => (document.getElementById(id)?.textContent || '');
  const out = {
    plain: !!document.getElementById('pm-signout'),
    erase: !!document.getElementById('pm-signout-erase'),
    del: !!document.getElementById('pm-delete-account'),
    plainReversible: /sign back in/i.test(txt('pm-signout')),
    delPermanent: /cannot be undone|permanent/i.test(txt('pm-delete-account')),
    delOnlyRed: document.getElementById('pm-delete-account')?.classList.contains('danger') === true
                && document.getElementById('pm-signout')?.classList.contains('danger') === false,
    fnErase: typeof window.signOutAndErase,
    fnDel: typeof window._confirmDeleteAccount
  };
  document.querySelector('.prof-menu')?.remove();
  return out;
});
ok(wired.plain, 'the menu offers an ordinary sign-out (erasing is opt-in, never forced)');
ok(wired.erase, 'it offers "Sign out & erase this device" for a shared computer');
ok(wired.del, 'and it offers "Delete account" - no longer buried in Settings');
ok(wired.plainReversible, 'sign-out says in the menu that you can sign back in');
ok(wired.delPermanent, 'deletion says in the menu that it cannot be undone');
ok(wired.delOnlyRed, 'only the irreversible exit is styled as destructive');
ok(wired.fnErase === 'function' && wired.fnDel === 'function', 'both handlers exist');

section('Delete account really opens the typed confirmation');
const dlg = await page.evaluate(() => {
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  showProfMenu(document.body);
  document.getElementById('pm-delete-account').click();
  const inp = document.getElementById('del-confirm'), go = document.getElementById('del-go');
  const before = go ? go.disabled : null;
  if(inp){ inp.value = 'delete'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  const afterRight = go ? go.disabled : null;
  if(inp){ inp.value = 'yes'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  const afterWrong = go ? go.disabled : null;
  closeOvr();
  return { opened: !!inp, before, afterRight, afterWrong };
});
ok(dlg.opened === true, 'clicking it really opens the dialog (not a dead button - LESSONS #5)');
ok(dlg.before === true, 'the delete button starts disabled');
ok(dlg.afterRight === false, 'typing DELETE enables it');
ok(dlg.afterWrong === true, 'and anything else disables it again');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
