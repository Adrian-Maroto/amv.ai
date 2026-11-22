/* THE COUNTRY YOU CHOSE IS STILL CHOSEN (Nov 22).

   The owner picked a country for Crew, refreshed, and saw another one. The
   choice is saved per account, and it was read once, when the script
   started - so whoever was known at that instant decided which saved choice
   was read. A page that started before the account was known (returning from
   a sign-in, a session still being restored) read the guest's empty slot,
   guessed from the network, and drew another country. A country picked
   before signing in was filed under the guest and lost at sign-in.

   Each path is driven here in a real browser, through the real picker. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: null });
const p = app.page;
const shown = () => p.evaluate(() => ({ cc: _cwCountryGuess(), head: (document.getElementById('cx-jobs-h') || {}).textContent || '' }));
const pick = async (cc) => {
  await p.evaluate(() => { setTab('crew'); });
  await p.waitForSelector('#cw-where', { timeout: 20000 });
  await p.click('#cw-where');
  await p.waitForSelector(`#ccp-list [data-ccp="${cc}"]`, { timeout: 20000 });
  await p.click(`#ccp-list [data-ccp="${cc}"]`);
  await p.waitForTimeout(500);
};
const reload = async () => { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800); await p.evaluate(() => { try { goApp(); setTab('crew'); } catch (e) {} }); await p.waitForTimeout(1500); };
const signIn = async (email) => p.evaluate((email) => { S.user = { name: 'T', email, ini: 'T' }; localStorage.setItem('amv_user', JSON.stringify(S.user)); try { setTab('crew'); } catch (e) {} }, email);

section('Chosen, then the page is refreshed');
{
  await signIn('ana@example.com');
  await pick('FR');
  ok((await shown()).cc === 'FR', 'the pick is shown at once', await shown());
  /* A refresh on the live site: the page starts, then the session comes
     back. (With no server here the stored session cannot be confirmed, so it
     is restored by hand, as the cookie does there.) */
  await reload();
  await signIn('ana@example.com');
  await p.waitForTimeout(800);
  const s = await shown();
  ok(s.cc === 'FR' && /France/.test(s.head), 'and after a refresh it is still France', s);
}

section('The page starts before it knows who is signed in');
{
  /* What a return from a sign-in looks like: the account is stored only
     after the page has started. */
  await p.evaluate(() => { localStorage.removeItem('amv_user'); });
  await reload();
  await signIn('ana@example.com');
  await p.waitForTimeout(800);
  const s = await shown();
  ok(s.cc === 'FR' && /France/.test(s.head), 'once the account is known, its own choice is the one shown', s);
}

section('Chosen before signing in, kept after');
{
  await p.evaluate(() => { localStorage.removeItem('amv_user'); S.user = null; });
  await reload();
  await pick('DE');
  ok((await shown()).cc === 'DE', 'a visitor picks Germany', await shown());
  await signIn('new-person@example.com');
  await p.waitForTimeout(500);
  const s = await shown();
  ok(s.cc === 'DE', 'and the account they sign into keeps it', s);
  await reload();
  await signIn('new-person@example.com');
  await p.waitForTimeout(500);
  ok((await shown()).cc === 'DE', 'across a refresh too', await shown());
}

section('Another account on the same device keeps its own');
{
  await signIn('ana@example.com');
  await p.waitForTimeout(400);
  ok((await shown()).cc === 'FR', 'Ana still has France, not the visitor’s Germany', await shown());
}

await app.close();
if (report('the-country-you-chose-is-still-chosen') > 0) process.exitCode = 1;
done();
