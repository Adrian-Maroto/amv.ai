/* SYNC, FROM THE APP'S SIDE - signing in used to overwrite whatever was on the
   device with whatever the server held. Anything done offline, or on a device
   that had not pushed yet, was gone the moment the user signed in. These
   assertions drive the real client merge. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

section('Work done on this device survives signing in');
const merged = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  // Something written here and never pushed - e.g. drafted on a plane.
  S.convs = [{ id: 'local1', title: 'Written offline', msgs: [{ r: 'u', c: 'hi' }], updated: 500 }];
  // The server has different conversations from another device.
  window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({
    ok: true, rev: 7,
    data: { convs: [{ id: 'srv1', title: 'From the laptop', msgs: [{ r: 'u', c: 'x' }], updated: 400 }] } }) });
  await AMVSync.pull();
  return { ids: S.convs.map(c => c.id), rev: AMV_API.syncRev };
});
ok(merged.ids.includes('local1'), 'the conversation written on this device is still here', merged.ids);
ok(merged.ids.includes('srv1'), 'and the one from the other device arrived too', merged.ids);
ok(merged.ids[0] === 'local1', 'newest first, so the most recent work is on top', merged.ids);
ok(merged.rev === 7, 'the server revision is remembered for the next push', merged.rev);

section('The same conversation edited in both places keeps the longer, newer one');
const same = await page.evaluate(async () => {
  S.convs = [{ id: 'c1', title: 'here', msgs: [{ r: 'u', c: '1' }], updated: 100 }];
  window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({
    ok: true, rev: 8, data: { convs: [{ id: 'c1', title: 'there',
      msgs: [{ r: 'u', c: '1' }, { r: 'a', c: '2' }, { r: 'u', c: '3' }], updated: 900 }] } }) });
  await AMVSync.pull();
  return { n: S.convs.length, msgs: S.convs[0].msgs.length, title: S.convs[0].title };
});
ok(same.n === 1, 'it is not duplicated', same.n);
ok(same.msgs === 3 && same.title === 'there', 'and the newer version wins', same);

section('A push declares the revision it was working from');
const pushed = await page.evaluate(async () => {
  let sent = null;
  window.fetch = async (u, o) => {
    sent = JSON.parse(o.body);
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, rev: 9, merged: false }) };
  };
  await AMV_API.syncPush({ convs: S.convs });
  return { baseRev: sent && sent.baseRev, rev: AMV_API.syncRev };
});
ok(pushed.baseRev === 8, 'it sends the revision the last pull returned', pushed.baseRev);
ok(pushed.rev === 9, 'and records the new one the server assigned', pushed.rev);

section('When the server says it merged, the app pulls the result back');
/* Otherwise this device keeps working from a list the server has already moved
   past, and pushes the same conflict again on every change. */
const reconciled = await page.evaluate(async () => {
  let pulls = 0;
  window.fetch = async (u) => {
    if (String(u).includes('/sync/pull')) {
      pulls++;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, rev: 11, data: { convs: [] } }) };
    }
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, rev: 10, merged: true }) };
  };
  await AMV_API.syncPush({ convs: [] });
  await new Promise(r => setTimeout(r, 200));
  return pulls;
});
ok(reconciled >= 1, 'a merged push is followed by a pull, so the device catches up', reconciled);

section('Conversations are stamped when written');
const stamped = await page.evaluate(() => {
  newChat();
  const before = getCurConv().updated || 0;
  setMsgs([{ r: 'u', c: 'hello' }]);
  return { before, after: getCurConv().updated };
});
ok(typeof stamped.after === 'number' && stamped.after > 0, 'writing a message stamps the conversation', stamped.after);
ok(stamped.after >= stamped.before, 'and the stamp moves forward');

section('No JavaScript errors');
section('A pull cannot delete a skill this device just made');
{
  /* Skills and handoffs used to be stored straight over the top of whatever the
     server sent. The server's copy is a union of everything it has SEEN - which
     by definition excludes anything written here since the last push. */
  const r = await page.evaluate(async () => {
    store('amv_skills', [{ id: 'local-only', name: 'Local only', text: 'made here, never pushed' }]);
    store('amv_handoffs', [{ id: 'h-local', title: 'Local handoff' }]);
    AMV_API.syncPull = async () => ({
      skills: [{ id: 'from-server', name: 'From server', text: 'x' }],
      handoffs: [{ id: 'h-server', title: 'Server handoff' }],
    });
    await AMVSync.pull();
    return {
      skills: (load('amv_skills') || []).map(x => x.id).sort(),
      handoffs: (load('amv_handoffs') || []).map(x => x.id).sort(),
    };
  });
  ok(r.skills.includes('local-only'), 'the skill made on this device survives the pull', r.skills);
  ok(r.skills.includes('from-server'), 'and the server\u2019s skill arrives', r.skills);
  ok(r.handoffs.includes('h-local') && r.handoffs.includes('h-server'), 'same for handoffs', r.handoffs);
}

ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();

report();
done();
