/* STATE THAT IS WRITTEN AND NEVER READ.

   A sweep for keys the app saves and nothing loads found three worth fixing,
   each a different failure wearing the same disguise - nothing throws, because
   nothing runs.

     - Every conversation save wrote a second, FULL copy of every conversation
       to a key no code path reads, while the real save deliberately slims
       attachments and keeps the last 40 messages to stay inside the quota. The
       copy nobody could read was the one ignoring the budget.
     - A team invite clicked before Teams was available was stored for later and
       never picked up, so the link was spent and the person joined nothing.
     - ?owner=1 wrote an owner flag. Nothing reads it, which is the correct and
       only safe answer, and this pins it there.

   These are cheap to reintroduce and invisible when they happen, so each one
   gets an assertion rather than a comment. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

section('Saving a conversation writes one copy, to the key that is read back');
{
  const r = await page.evaluate(async () => {
    const wrote = [];
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { wrote.push({ k, n: String(v).length }); return real(k, v); };
    S.user = { name: 'U', email: 'u@x.com', ini: 'U' };
    S.convs = [{ id: 'c1', title: 'T', msgs: [{ r: 'user', c: 'hello there' }] }];
    S.cur = 'c1';
    _autoSave();
    localStorage.setItem = real;
    return { wrote, key: convKey('u@x.com') };
  });
  ok(!r.wrote.some(x => /amv_convs/.test(x.k)),
     'no second copy is written to the key nothing reads', r.wrote.map(x => x.k));
  ok(r.wrote.some(x => x.k.indexOf(r.key) >= 0),
     'and the per-account save that IS read back still happens', { wrote: r.wrote.map(x => x.k), want: r.key });
}

section('What is saved is what can be loaded');
{
  /* The property that actually matters: a round trip. */
  const r = await page.evaluate(() => {
    const back = loadUserConvs('u@x.com');
    return { n: back ? back.length : 0, title: back && back[0] && back[0].title };
  });
  ok(r.n === 1 && r.title === 'T', 'a saved conversation comes back', r);
}

section('An attachment is not stored at full size');
{
  /* The reason the dead copy mattered: the real save strips attachment bodies,
     and the dead one did not, so heavy accounts filled localStorage on data
     that could never be shown to anybody. */
  const r = await page.evaluate(() => {
    const big = 'x'.repeat(200000);
    S.convs = [{ id: 'c2', title: 'A', msgs: [{ r: 'user', c: { big }, d: '[file]' }] }];
    S.cur = 'c2';
    _autoSave();
    const raw = localStorage.getItem(_scopeKey(convKey('u@x.com'))) || '';
    return { len: raw.length, hasBig: raw.indexOf('x'.repeat(1000)) >= 0 };
  });
  ok(!r.hasBig, 'the attachment body is not written', r.len);
  ok(r.len < 50000, 'so one message cannot consume the whole quota', r.len);
}

section('An invite that arrives too early is not thrown away');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_pending_invite', 'tok-123');
    const joined = [];
    window.AMVTeam.enabled = () => true;
    window.AMVTeam.join = async (t) => { joined.push(t); return { ok: true }; };
    window.toast = () => {};
    window.setTab = () => {};
    _checkTeamInvite();
    await new Promise(r => setTimeout(r, 150));
    return { joined, left: loadStr('amv_pending_invite') };
  });
  ok(r.joined.length === 1 && r.joined[0] === 'tok-123',
     'the stored invite is redeemed once Teams is available', r.joined);
  ok(!r.left, 'and consumed, so a spent token is not retried forever', r.left);
}

section('An invite that cannot be used yet is kept, not burned');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_pending_invite', '');
    history.replaceState({}, '', location.pathname + '?invite=tok-456');
    let joins = 0;
    window.AMVTeam.enabled = () => false;
    window.AMVTeam.join = async () => { joins++; return {}; };
    _checkTeamInvite();
    await new Promise(r => setTimeout(r, 120));
    const kept = loadStr('amv_pending_invite');
    history.replaceState({}, '', location.pathname);
    return { kept, joins };
  });
  ok(r.kept === 'tok-456', 'it is held until Teams can accept it', r.kept);
  ok(r.joins === 0, 'and not spent against a team feature that is off', r.joins);
}

section('The owner flag grants nothing, which is the only safe answer');
{
  /* ?owner=1 is settable by anyone who can type. The gate is the account email
     and nothing else - this asserts the flag stays inert. */
  const r = await page.evaluate(() => {
    saveStr('amv_owner', '1');
    S.user = { name: 'U', email: 'not-the-owner@x.com', ini: 'U' };
    return { owner: isOwnerMode(), admin: isAdmin() };
  });
  ok(r.owner === false, 'setting the flag does not make you the owner', r);
  ok(r.admin === false, 'nor an admin', r);
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('dead-state') > 0) process.exitCode = 1;
done();
