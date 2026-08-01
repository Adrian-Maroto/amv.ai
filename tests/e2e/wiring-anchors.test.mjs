/* EVERY ANCHOR THE APP REACHES FOR HAS TO EXIST.

   The Admin tab had exactly one entry point. It built a button and inserted it
   after `.snb[data-tab="tasks"]` - a selector the sidebar stopped matching when
   Tasks moved into the tool rail. querySelector returned null, the guard above
   it returned early, nothing threw, nothing logged, and the operator view became
   unreachable from the app. It was found by accident, months later.

   That is a whole class of bug and it is invisible by construction: the failure
   of `document.getElementById(x)` when x does not exist is silence, and almost
   every one of these lookups is wrapped in exactly the `if (!el) return` that
   makes the silence permanent.

   So this walks the shipped bundle for the ids and structural selectors the
   wiring code depends on, boots the real app, and checks each one is actually
   there. It is deliberately about ANCHORS - the containers and entry points that
   other things are attached to - rather than every id in the file, because a
   missing anchor takes a whole feature with it.

   When this fails, do not delete the assertion. Either the markup lost something
   or the code is looking for something that no longer exists, and both of those
   are the bug. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'app.js'), 'utf8');

const app = await bootApp({ tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;

const exists = (sel) => page.evaluate(s => !!document.querySelector(s), sel);

/* The anchors that other things are ATTACHED to. Each of these is a container
   or entry point the app inserts into or navigates from, so losing one silently
   removes whatever depends on it. */
section('Structural anchors the app inserts into still exist');
{
  const ANCHORS = [
    ['#sb-tools',     'the sidebar tool rail - Admin and Team are injected or revealed here'],
    ['#sb-popup',     'the account menu'],
    ['#vc',           'the view container every screen renders into'],
    ['#app',          'the app shell'],
    ['#ovr',          'the modal overlay every dialog is built inside'],
    ['#mta',          'the composer - the first-run card and activation offers type into it'],
    ['#hist',         'the conversation list'],
    ['#build-group',  'the collapsible Build group'],
    ['#build-toggle', 'its toggle'],
  ];
  for (const [sel, why] of ANCHORS) {
    ok(await exists(sel), sel + ' is present - ' + why);
  }
}

section('Every nav button routes to a view that renders');
{
  /* A tab in the sidebar that the router has no case for leaves the last
     screen on screen, which reads as a dead click rather than an error. */
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tab]')].map(b => b.dataset.tab));
  ok(tabs.length > 5, 'the sidebar has nav buttons at all', tabs.length);

  const dead = [];
  for (const t of tabs) {
    const r = await page.evaluate(tab => {
      const vc = document.getElementById('vc');
      vc.innerHTML = '<span id="__sentinel"></span>';
      try { setTab(tab); } catch (e) { return { tab, threw: String(e) }; }
      return { tab, landed: S.tab, stale: !!document.getElementById('__sentinel') };
    }, t);
    if (r.threw || r.stale) dead.push(r);
  }
  ok(dead.length === 0, 'every nav button reaches a view that actually renders', dead);
}

section('The owner can reach the operator view, and nobody else can');
{
  /* The exact bug: this entry point is built at runtime and had no test, so
     when its anchor stopped matching it failed silently and completely. */
  const shown = await page.evaluate(() => {
    window.isAdmin = () => true;
    _revealAdminNav();
    const b = document.getElementById('nav-admin');
    if (!b) return { there: false };
    b.click();
    return { there: true, tab: S.tab, attached: !!b.closest('#sb-tools') };
  });
  ok(shown.there, 'the Admin entry point is built', shown);
  ok(shown.attached, 'and attached to an anchor that exists', shown);
  ok(shown.tab === 'admin', 'and clicking it opens the operator view', shown.tab);

  const hidden = await page.evaluate(() => {
    window.isAdmin = () => false;
    _revealAdminNav();
    return !document.getElementById('nav-admin');
  });
  ok(hidden, 'and it is absent from the DOM entirely for everybody else');
}

section('Nothing in the bundle waits on an element that was removed');
{
  /* Pull the ids the code reaches for out of the shipped bundle and check them
     against the shipped markup. Only ids that appear in the STATIC document are
     checked - anything rendered later legitimately does not exist at boot - so
     this asks a narrow question with no false positives: does the code look for
     a static id that the document no longer has? */
  const wanted = new Set();
  for (const m of src.matchAll(/getElementById\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g)) wanted.add(m[1]);
  for (const m of src.matchAll(/\$\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g)) wanted.add(m[1]);
  ok(wanted.size > 50, 'the sweep actually found lookups to check', wanted.size);

  /* The narrow, certain signal. Plenty of ids are built dynamically - a helper
     that takes an id as an argument means the literal appears in the bundle
     without appearing in the markup - so "not in index.html" alone is noisy.
     But an id that is LOOKED UP and appears nowhere else in the entire bundle
     is referenced by nothing that could create it. That lookup can never
     succeed, and whatever was attached to it is gone. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const declaredStatic = new Set([...html.matchAll(/\sid=["']([a-zA-Z0-9_-]+)["']/g)].map(m => m[1]));
  const dead = [];
  for (const id of wanted) {
    if (declaredStatic.has(id)) continue;
    const mentions = (src.match(new RegExp("['\"]" + id.replace(/-/g, '[-]') + "['\"]", 'g')) || []).length;
    if (mentions <= 1) dead.push(id);
  }
  ok(dead.length === 0,
     'no element lookup targets an id nothing anywhere creates', dead.slice(0, 12));
}

section('No handler is bound to a data-attribute nothing renders');
{
  /* The same failure one level along, and the id sweep cannot see it. The
     billing screen computed a list of plans the customer could switch to,
     bound a click handler to `[data-pay]`, and rendered no such button - so a
     paying customer had no upgrade path and no cancel control, on the one page
     that exists to change what they pay.

     An attribute is "rendered" if it appears anywhere in the shipped bundle or
     markup followed by `=` (a value) or by a quote, space or `>` (a bare
     attribute like `data-i18n`). Bound but never written is dead wiring. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const all = src + html;
  const bound = new Set();
  for (const m of src.matchAll(/querySelectorAll?\(\s*['"]\[(data-[a-z0-9-]+)\][^'"]*['"]/g)) bound.add(m[1]);
  for (const m of src.matchAll(/closest\(\s*['"]\[(data-[a-z0-9-]+)\]['"]\s*\)/g)) bound.add(m[1]);
  ok(bound.size > 5, 'the sweep found delegated handlers to check', bound.size);

  const dead = [];
  for (const attr of bound) {
    const esc = attr.replace(/-/g, '[-]');
    const rendered = (all.match(new RegExp(esc + '(=|\\\\?["\'> ])', 'g')) || []).length;
    if (rendered === 0) dead.push(attr);
  }
  ok(dead.length === 0, 'every delegated handler has markup that can trigger it', dead);
}

section('Structural selectors in the wiring code still match the markup');
{
  /* querySelector with a structural selector is the exact failure the Admin
     tab hit: the element moved, the selector kept compiling, and the code went
     quiet. Anything the bundle selects by class-plus-attribute has to match
     something in the shipped document. */
  const sels = new Set();
  for (const m of src.matchAll(/querySelector\(\s*['"](\.[a-zA-Z0-9_-]+\[[^'"]+\])['"]\s*\)/g)) sels.add(m[1]);

  const broken = [];
  for (const sel of sels) {
    if (!(await exists(sel))) broken.push(sel);
  }
  ok(broken.length === 0,
     'every class-and-attribute selector the wiring uses matches a real element', broken);
}

ok(errors.length === 0, 'and none of it logged an error', errors.slice(0, 3));

await app.close();
if (report('wiring-anchors') > 0) process.exitCode = 1;
done();
