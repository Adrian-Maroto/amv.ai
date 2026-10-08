/* A DELETED CHAT STAYS DELETED - AND CAN BE BROUGHT BACK FOR 30 DAYS.

   Deleting a chat removed it from the list, and the list is merged by id
   between devices. So the phone, still holding the chat, merged it straight
   back on its next sync: deleted on one device, back on all of them. Archive
   and Trash are built on the fix - a chat leaves Recents by being MARKED, the
   mark is newer than any stale copy, and the merge keeps the newest.

   Two devices are played here by one page and a hand-made server record,
   which is exactly what the sync pull hands the merge. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  const now = Date.now();
  const mk = (id, title, ago) => ({ id, title, model: 'auto', starred: false, created: now - ago, updated: now - ago,
    msgs: [{ r: 'u', c: 'About ' + title }, { r: 'a', c: 'Answer on ' + title }] });
  S.convs = [mk('c-trip', 'Trip to Lisbon', 1000), mk('c-tax', 'Tax questions', 2000), mk('c-gift', 'Gift ideas', 3000)];
  S.cur = 'c-trip';
  _CONV_SHELF = [];
  window.__confirm = true;
  window.showConfirmAsync = async () => window.__confirm;
  renderHist();
});
const state = () => page.evaluate(() => ({
  live: S.convs.map(c => c.id),
  shelf: _CONV_SHELF.map(c => ({ id: c.id, archived: !!c.archived, trashed: !!c.trashed, gone: !!c.gone, title: c.title, n: (c.msgs || []).length })),
  stored: (loadUserConvs(S.user.email) || []).map(c => c.id),
  storedAll: (load(convKey(S.user.email)) || []).map(c => ({ id: c.id, archived: !!c.archived, trashed: !!c.trashed, gone: !!c.gone })),
  door: (document.querySelector('.hist-shelf') || {}).textContent || '',
}));

section('Archive takes a chat out of Recents without losing it');
{
  await page.evaluate(() => archiveConv('c-tax'));
  const s = await state();
  ok(!s.live.includes('c-tax'), 'it leaves the chat list', s.live);
  ok(s.shelf.some(c => c.id === 'c-tax' && c.archived && c.n === 2), 'it is on the shelf, whole', s.shelf);
  ok(s.storedAll.some(c => c.id === 'c-tax' && c.archived), 'and saved as archived, so a reload keeps it archived', s.storedAll);
  ok(!s.stored.includes('c-tax'), 'while a reload still lists only the live chats', s.stored);
  ok(/Archived & Trash/.test(s.door) && /1/.test(s.door), 'and Recents shows the way back', s.door);
}

section('Delete moves a chat to Trash, and it can be restored');
{
  await page.evaluate(() => deleteConv('c-gift'));
  let s = await state();
  ok(!s.live.includes('c-gift') && s.shelf.some(c => c.id === 'c-gift' && c.trashed), 'a deleted chat goes to Trash', s.shelf);
  await page.evaluate(() => openChatShelf());
  const screen = await page.evaluate(() => document.getElementById('shelf-body').textContent);
  ok(/Gift ideas/.test(screen) && /days left/.test(screen) && /Tax questions/.test(screen), 'the screen lists it with the days it has left, beside the archived one', screen.slice(0, 200));
  await page.click('[data-dact="restoreConv"][data-darg="c-gift"]');
  s = await state();
  ok(s.live[0] === 'c-gift' && !s.shelf.some(c => c.id === 'c-gift'), 'Restore puts it back at the top of the chat list', s.live);
  await page.evaluate(() => closeOvr());
}

section('A delete beats a stale copy from another device');
{
  /* This device deletes "Trip to Lisbon". Another device, which has not heard
     yet, still has the live chat - older than the delete - and that is what
     the server hands back on the next pull. */
  const r = await page.evaluate(async () => {
    const stale = JSON.parse(JSON.stringify(S.convs.find(c => c.id === 'c-trip')));
    deleteConv('c-trip');
    Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
    Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true });
    AMV_API.syncPull = async () => ({ convs: [stale] });
    await AMVSync.pull();
    return { live: S.convs.map(c => c.id), trip: _CONV_SHELF.find(c => c.id === 'c-trip') || null };
  });
  ok(!r.live.includes('c-trip'), 'the stale live copy does not bring it back', r.live);
  ok(r.trip && r.trip.trashed, 'it is still in Trash', r.trip && { trashed: r.trip.trashed });
}

section('A delete made on another device arrives here');
{
  const r = await page.evaluate(async () => {
    const tomb = { id: 'c-gift', gone: true, title: '', msgs: [], created: 0, updated: Date.now() + 1000 };
    AMV_API.syncPull = async () => ({ convs: [tomb] });
    await AMVSync.pull();
    return { live: S.convs.map(c => c.id), cur: S.cur };
  });
  ok(!r.live.includes('c-gift'), 'a chat deleted for good elsewhere leaves this device too', r.live);
  ok(r.live.includes(r.cur), 'and the open chat is still one that exists', r.cur);
}

section('What goes to the server');
{
  const out = await page.evaluate(() => {
    S.convs = [{ id: 'c-temp', title: 'Temporary', temp: true, msgs: [{ r: 'u', c: 'secret' }], created: Date.now(), updated: Date.now() }].concat(S.convs);
    return AMVSync.collect().convs.map(c => ({ id: c.id, trashed: !!c.trashed, archived: !!c.archived, gone: !!c.gone }));
  });
  ok(out.some(c => c.id === 'c-trip' && c.trashed) && out.some(c => c.id === 'c-tax' && c.archived), 'archived and trashed chats travel as marked records', out);
  ok(!out.some(c => c.id === 'c-temp'), 'a temporary chat never does', out);
  await page.evaluate(() => { S.convs = S.convs.filter(c => !c.temp); });
}

section('Delete for good leaves nothing to read');
{
  await page.evaluate(() => openChatShelf());
  await page.click('[data-dact="purgeConv"][data-darg="c-trip"]');
  await page.waitForTimeout(100);
  const s = await state();
  const trip = s.shelf.find(c => c.id === 'c-trip');
  ok(trip && trip.gone && trip.n === 0 && trip.title === '', 'the content is gone, and only a marker is left so other devices hear of it', trip);
  const screen = await page.evaluate(() => document.getElementById('shelf-body').textContent);
  ok(!/Trip to Lisbon/.test(screen), 'and it is no longer listed', screen.slice(0, 160));
  await page.evaluate(() => closeOvr());
}

section('Trash empties itself after 30 days; markers expire after 90');
{
  const r = await page.evaluate(() => {
    const day = 864e5, now = Date.now();
    const live = _shelfSplit([
      { id: 'old-trash', title: 'Old', trashed: now - 31 * day, updated: now - 31 * day, msgs: [{ r: 'u', c: 'x' }] },
      { id: 'new-trash', title: 'New', trashed: now - 2 * day, updated: now - 2 * day, msgs: [{ r: 'u', c: 'y' }] },
      { id: 'old-tomb', gone: true, title: '', msgs: [], updated: now - 91 * day },
      { id: 'live-one', title: 'Live', msgs: [], updated: now },
    ]);
    return { live: live.map(c => c.id), shelf: _CONV_SHELF.map(c => ({ id: c.id, gone: !!c.gone, n: (c.msgs || []).length })) };
  });
  ok(r.live.length === 1 && r.live[0] === 'live-one', 'only live chats are listed', r.live);
  ok(r.shelf.some(c => c.id === 'old-trash' && c.gone && c.n === 0), 'a chat in Trash past 30 days is deleted for good', r.shelf);
  ok(r.shelf.some(c => c.id === 'new-trash' && !c.gone), 'one deleted two days ago is still restorable');
  ok(!r.shelf.some(c => c.id === 'old-tomb'), 'and a marker past 90 days is dropped', r.shelf);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-deleted-chat-stays-deleted') > 0) process.exitCode = 1;
done();
