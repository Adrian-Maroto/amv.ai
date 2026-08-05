/* EVERY KEYBOARD SHORTCUT WAS DEAD ON A MAC, AND THE SHEET SAID TO PRESS ⌘.

   The cheat sheet detects the platform and renders ⌘ symbols on macOS. Every
   handler tested `e.ctrlKey` alone, which on a Mac is the Control key - so
   ⌘⇧O, ⌘⇧L, ⌘B, ⌘, ⌘/ ⌘⇧D and ⌘⇧V did nothing at all. The command palette was
   the only one that worked, because 01-core happened to test
   `(e.metaKey || e.ctrlKey)`. So the one screen that documents the shortcuts
   told Mac users precisely which dead key to press.

   And there were THREE lists of them, no two agreeing:

     - _SHORTCUTS (the ? sheet): 12 bindings, grouped, platform-aware, and
       missing Ctrl+B which is bound.
     - openShortcuts (the sidebar button): 8 rows, hand-written, Ctrl printed
       on Macs, and it labelled Ctrl+K "Search chats" when it opens the
       command palette.
     - the About screen: 6 rows, hand-written, also Ctrl on Macs.

   One list now, two presentations of it, and a check that what it documents is
   what actually fires. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Fire a real keydown at the document and report what changed. Each case names
   its own observable effect - a shortcut that "runs" without doing anything is
   not a shortcut. */
async function press({ key, meta = false, ctrl = false, shift = false }, probe) {
  return page.evaluate(({ key, meta, ctrl, shift, probe }) => {
    const before = (new Function('return (' + probe + ')'))()();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key, metaKey: meta, ctrlKey: ctrl, shiftKey: shift, bubbles: true, cancelable: true,
    }));
    const after = (new Function('return (' + probe + ')'))()();
    return { before, after, changed: before !== after };
  }, { key, meta, ctrl, shift, probe: probe.toString() });
}

section('The documented list is the only list');
{
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const shortAt = src.indexOf('function openShortcuts');
  const shortBody = src.slice(shortAt, shortAt + 300);
  ok(shortAt > 0 && /openShortcutSheet\(\)/.test(shortBody),
     'the old sidebar sheet opens the real one', shortBody.slice(0, 100));

  /* Anchored on the MARKUP. `indexOf('Keyboard Shortcuts')` finds the i18n
     dictionary entry first - a translation key, thousands of lines before the
     About screen - so an unanchored search reads a block of JSON and concludes
     the fix is missing. */
  const aboutAt = src.indexOf('<h3>Keyboard Shortcuts</h3>');
  ok(aboutAt > 0, 'the About block was located', aboutAt);
  ok(/_shortcutRowsHTML\(\)/.test(src.slice(aboutAt, aboutAt + 300)),
     'and the About screen renders from the same list', src.slice(aboutAt, aboutAt + 120));

  /* The claim is that the SHORTCUT LIST no longer mislabels Cmd+K. Searching
     the whole bundle for "Search chats" matches the sidebar's own search
     placeholder, which is a different, real feature - an assertion that fails
     on unrelated correct code is worse than none. The hand-written rows are
     gone entirely, so that is what is checked. */
  ok(!/\['Search chats'|Search chats','Ctrl K/.test(src),
     'the hand-written row calling Cmd+K "Search chats" is gone', true);
  ok(!/\['New chat','Ctrl Shift O'\]/.test(src),
     'and so is the rest of that hand-written list', true);
}

section('Nothing in the client listens for Ctrl without Cmd');
{
  /* The property. A new binding written the old way is dead on every Mac. */
  const files = ['01-core.js', '03-sessions.js', '05-ui-blocks.js', '12-handoff.js', '16-palette-sched.js'];
  /* Comments stripped FIRST. The block comment explaining this very fix quotes
     `e.ctrlKey` in prose, and a line-start check for // or * does not catch a
     line in the middle of a /* *\/ block - so the scan flagged its own
     documentation. Strip, then scan code. */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p);
  const bad = [];
  for (const f of files) {
    stripComments(readFileSync(join(ROOT, 'src', 'app', f), 'utf8')).split('\n').forEach((l, i) => {
      if (!/\bctrlKey\b/.test(l)) return;
      if (/metaKey/.test(l)) return;
      if (/function _mod/.test(l)) return;
      bad.push(`${f}:${i + 1}  ${l.trim().slice(0, 80)}`);
    });
  }
  ok(bad.length === 0, 'every modifier check accepts Cmd as well as Ctrl', bad);
}

section('Each shortcut the sheet documents actually fires - with Cmd');
{
  /* Driven with metaKey only, which is what a Mac sends. Before the fix every
     one of these did nothing. */
  const cases = [
    { name: 'new chat', key: 'o', shift: true,
      probe: () => (S.convs || []).length },
    { name: 'light / dark theme', key: 'l', shift: true,
      probe: () => document.body.classList.contains('light') ? 1 : 0 },
    { name: 'settings', key: ',',
      probe: () => S.tab },
    { name: 'help', key: '/',
      probe: () => S.tab },
  ];
  for (const c of cases) {
    await page.evaluate(() => { setTab('chat'); });
    const r = await press({ key: c.key, meta: true, shift: !!c.shift }, c.probe);
    ok(r.changed, `⌘ ${c.name} does something`, r);
  }
}

section('And still fires with Ctrl, for everyone else');
{
  await page.evaluate(() => { setTab('chat'); });
  const r = await press({ key: ',', ctrl: true }, () => S.tab);
  ok(r.after === 'settings', 'Ctrl+, still opens settings', r);
  await page.evaluate(() => { setTab('chat'); });
  const t = await press({ key: 'l', ctrl: true, shift: true },
    () => document.body.classList.contains('light') ? 1 : 0);
  ok(t.changed, 'and Ctrl+Shift+L still toggles the theme', t);
}

section('The sidebar toggle is documented, because it is bound');
{
  const r = await page.evaluate(() => {
    const flat = _SHORTCUTS.flatMap(s => s.items.map(i => (i.alt || i.keys).join('+')));
    return { flat, hasB: flat.some(k => /Ctrl\+B/i.test(k)) };
  });
  ok(r.hasB, 'Ctrl+B is on the list', r.flat);

  await page.evaluate(() => { document.activeElement?.blur(); });
  const fired = await press({ key: 'b', meta: true },
    () => document.body.className + '|' + (document.getElementById('sb') || {}).className);
  ok(fired.changed, 'and ⌘B really moves the sidebar', fired);
}

section('The sheet shows Cmd on a Mac and Ctrl elsewhere');
{
  const r = await page.evaluate(() => {
    const real = navigator.platform;
    const read = () => _shortcutRowsHTML();
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const mac = read();
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const win = read();
    Object.defineProperty(navigator, 'platform', { value: real, configurable: true });
    return { macHasCmd: /⌘/.test(mac), macHasCtrl: /<kbd>Ctrl<\/kbd>/.test(mac),
             winHasCtrl: /<kbd>Ctrl<\/kbd>/.test(win) };
  });
  ok(r.macHasCmd, 'a Mac is shown ⌘', r);
  ok(!r.macHasCtrl, 'and not Ctrl', r);
  ok(r.winHasCtrl, 'while Windows is shown Ctrl', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('shortcuts-are-one-list') > 0) process.exitCode = 1;
done();
