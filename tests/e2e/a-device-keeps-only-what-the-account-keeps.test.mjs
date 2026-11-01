/* A DEVICE KEEPS ONLY WHAT THE ACCOUNT KEEPS (Oct 31 audit, item 108).

   The server trims conversations older than the chosen period
   (34a-retention.js); this drives the real client pull to show the device
   follows: what only this device still held, older than the period by its
   last change, is removed from storage and from the list on screen; what is
   recent or has no date stays; the open conversation moves if it went; and
   with no period nothing is touched. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;
const DAY = 864e5;

section('With no period, a pull leaves old conversations alone');
{
  const r = await page.evaluate(async (DAY) => {
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
    S.convs = [{ id: 'ancient', title: 'old', msgs: [], updated: Date.now() - 400 * DAY }];
    window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, rev: 1, data: { convs: [] }, retention: null }) });
    await AMVSync.pull();
    return S.convs.map(c => c.id);
  }, DAY);
  ok(r.includes('ancient'), 'the old conversation is still here', r);
}

section('With 30 days, what only this device held and is older goes; recent and undated stay');
{
  const r = await page.evaluate(async (DAY) => {
    S.convs = [
      { id: 'old-here', title: 'old', msgs: [{ r: 'u', c: 'x' }], updated: Date.now() - 90 * DAY },
      { id: 'recent-here', title: 'recent', msgs: [], updated: Date.now() - 2 * DAY },
      { id: 'undated', title: 'no date', msgs: [] },
    ];
    S.cur = 'old-here';
    store(_sessKey(), [{ id: 's-old', kind: 'dev', updated: Date.now() - 60 * DAY }, { id: 's-new', kind: 'dev', updated: Date.now() }]);
    _SESSIONS.length = 0; load(_sessKey()).forEach(x => _SESSIONS.push(x));
    window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, rev: 2,
      data: { convs: [{ id: 'from-server', title: 's', msgs: [], updated: Date.now() - DAY }] }, retention: { days: 30, by: 'team' } }) });
    await AMVSync.pull();
    return { ids: S.convs.map(c => c.id).sort(), stored: (load('amv_convs') || S.convs).map(c => c.id).sort(), cur: S.cur,
      sessions: _SESSIONS.map(x => x.id), retention: AMV_API.retention };
  }, DAY);
  ok(!r.ids.includes('old-here'), 'the old conversation only this device had is gone', r.ids);
  ok(r.ids.includes('recent-here') && r.ids.includes('undated') && r.ids.includes('from-server'), 'recent, undated and the server’s are kept', r.ids);
  ok(r.cur !== 'old-here' && r.ids.includes(r.cur), 'the open conversation moved to one that still exists', r.cur);
  ok(r.sessions.join(',') === 's-new', 'Recents follow the same rule', r.sessions);
  ok(r.retention && r.retention.days === 30, 'and the app remembers the period', r.retention);
}

ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));
await app.close();
report();
done();
