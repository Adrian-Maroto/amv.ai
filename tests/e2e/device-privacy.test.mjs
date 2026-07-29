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

section('The erase is reachable, and is not the default sign-out');
const wired = await page.evaluate(() => {
  showProfMenu(document.body);
  const has = !!document.getElementById('pm-signout-erase');
  const plain = !!document.getElementById('pm-signout');
  document.querySelector('.prof-menu')?.remove();
  return { has, plain, fn: typeof window.signOutAndErase };
});
ok(wired.has, 'the menu offers "Sign out & erase this device"');
ok(wired.plain, 'and the ordinary sign-out is still there (erasing is opt-in, not forced)');
ok(wired.fn === 'function', 'the handler exists');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
