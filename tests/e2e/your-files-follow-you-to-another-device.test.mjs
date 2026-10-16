/* YOUR FILES FOLLOW YOU TO ANOTHER DEVICE - AND THE LIBRARY SAYS WHERE THEY ARE.

   With file storage switched on, the library lists the account's files as
   well as this device's: a file uploaded on the laptop is on the phone's list,
   attaches from there, and is deleted from both places when deleted. A file
   only on this device says so, and can be copied up. With storage off, the
   library says files are kept on this device only - never that they sync.

   The server is stubbed at its routes; its own behaviour is held by
   tests/worker/your-files-are-in-your-account. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();

const server = { configured: true, files: [{ id: 'lfremote1', sig: 'text|laptop.txt|11|x', kind: 'text', name: 'laptop.txt', size: 11, chars: 11, added: 1, used: 2 }],
                 bodies: { lfremote1: 'from laptop' }, puts: [], deletes: [] };
await page.route('**/v1/library**', async (route) => {
  const u = new URL(route.request().url());
  const J = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname.endsWith('/v1/library'))
    return J(server.configured ? { ok: true, configured: true, files: server.files, used: { files: server.files.length, bytes: 0 }, limit: { files: 100, bytes: 1e9 } }
                               : { ok: true, configured: false, files: [] });
  if (u.pathname.endsWith('/get')) { const id = u.searchParams.get('id'); return J({ ok: true, file: server.files.find(f => f.id === id), body: server.bodies[id] }); }
  if (u.pathname.endsWith('/put')) { const b = JSON.parse(route.request().postData()); server.puts.push(b);
    const f = { id: 'lfup' + server.puts.length, sig: b.sig, kind: b.kind, name: b.name, chars: b.body.length };
    server.files.push(f); server.bodies[f.id] = b.body; return J({ ok: true, file: f, verified: true }); }
  if (u.pathname.endsWith('/delete')) { const b = JSON.parse(route.request().postData()); server.deletes.push(...b.ids);
    server.files = server.files.filter(f => !b.ids.includes(f.id)); return J({ ok: true, deleted: b.ids.length }); }
  return J({ error: 'x' }, 404);
});

const open = async () => {
  await page.evaluate(() => openFileLibrary());
  await page.waitForFunction(() => { const b = document.getElementById('lib-body'); return b && !/Loading/.test(b.textContent); });
  await page.waitForTimeout(150);
  return page.evaluate(() => document.getElementById('lib-body').innerText);
};

section('A file kept from another device is on this one’s list');
{
  const t = await open();
  ok(/laptop\.txt/.test(t) && /In your account/.test(t), 'listed, and marked as in the account', t);
  ok(/on every device you sign in on/.test(t) && !/this device only/.test(t.replace(/This device only/g, '')), 'and the footer says where files are kept', t);
}

section('Attaching it fetches it, and it is what was kept');
{
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-lib-use]')].find(x => x.closest('.shelf-row').textContent.includes('laptop.txt')); b.click(); });
  await page.waitForFunction(() => S.att && S.att.name === 'laptop.txt', null, { timeout: 5000 });
  const att = await page.evaluate(() => ({ name: S.att.name, data: S.att.data }));
  ok(att.data === 'from laptop', 'the chat attaches the account’s copy', att);
  const here = await page.evaluate(async () => ((await _libAll()) || []).map(f => f.name));
  ok(here.includes('laptop.txt'), 'and it is kept on this device too, for next time', here);
}

section('A file only on this device says so, and can be copied up');
{
  await page.evaluate(async () => { await _libKeep({ kind: 'text', name: 'phone-only.txt', data: 'local words', size: 11 }); });
  await page.waitForTimeout(300);
  const autoUp = server.puts.map(p => p.name);
  ok(autoUp.includes('phone-only.txt'), 'a new file goes to the account as well, without waiting', autoUp);
  server.files = server.files.filter(f => f.name !== 'phone-only.txt');
  const t = await open();
  ok(/phone-only\.txt[\s\S]*This device only/.test(t), 'one the account does not have is marked "This device only"', t);
  const before = server.puts.length;
  await page.click('#lib-up');
  await page.waitForFunction((n) => true, before);
  await page.waitForTimeout(400);
  ok(server.puts.length > before && server.puts.slice(before).some(p => p.name === 'phone-only.txt' && p.body === 'local words'),
     'Keep in your account sends the file itself', server.puts.slice(before).map(p => p.name));
}

section('Deleting removes it from the account too');
{
  await open();
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-lib-rm]')].find(x => x.closest('.shelf-row').textContent.includes('laptop.txt')); b.click(); });
  await page.waitForTimeout(400);
  ok(server.deletes.includes('lfremote1'), 'the account’s copy was deleted', server.deletes);
  const here = await page.evaluate(async () => ((await _libAll()) || []).map(f => f.name));
  ok(!here.includes('laptop.txt'), 'and so was this device’s', here);
}

section('With storage off, the library says this device only - never that it syncs');
{
  server.configured = false;
  const t = await open();
  ok(/kept on this device only/.test(t) && !/every device/.test(t) && !/In your account/.test(t), 'honest about where files are', t);
}

section('In Spanish, the new words are Spanish');
{
  server.configured = true;
  await page.evaluate(async () => { saveStr('amv_lang', 'es'); try { _translateUI(); } catch (e) {} for (let i = 0; i < 50 && !_i18nPackHave('es'); i++) await new Promise(s => setTimeout(s, 100)); });
  const t = await open();
  ok(/en cada dispositivo/.test(t), 'the footer', t);
  await page.evaluate(() => { saveStr('amv_lang', 'en'); try { _translateUI(); } catch (e) {} });
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('your-files-follow-you-to-another-device') > 0) process.exitCode = 1;
done();
