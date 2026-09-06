/* A FIRST-TIME VISITOR ON A PHONE COULD NOT NAVIGATE.

   The cookie consent banner is fixed at the bottom of the screen with
   z-index 9999. The bottom navigation is fixed at the bottom of the screen
   with z-index 400 and is about 64px tall. The banner is 122px tall. Measured
   at 390x844: elementFromPoint at the centre of Chat, Build, Crew and More all
   returned the BANNER. Not overlapping the bar - on top of it, taking the tap.

   And the banner only appears on a first visit, so the people it blocked were
   exactly the people arriving for the first time, on the surface most of them
   arrive on.

   Neither half is wrong alone, which is why nothing caught it: a consent
   banner is supposed to sit above page content, a bottom bar is supposed to be
   pinned to the bottom, and no check asked whether two fixed elements land on
   each other. A screenshot showed it and read as "banner at the bottom", which
   is what a consent banner looks like.

   This asserts REACHABILITY, not geometry. Two boxes not overlapping is a
   proxy; what matters is which element receives the tap, and that is what
   elementFromPoint answers. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A genuinely first-time visitor: no stored consent, so the banner shows. */
const freshVisit = async (w, h) => {
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(900);
};

const probe = () => page.evaluate(() => {
  const vis = el => { const c = getComputedStyle(el), b = el.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const banner = [...document.querySelectorAll('div,section,aside')]
    .find(d => vis(d) && /Essential cookies keep AMV running/.test(d.textContent) && d.children.length < 8);
  const nav = [...document.querySelectorAll('button,a')]
    .filter(el => vis(el) && /^(Chat|Build|Crew|More)$/.test(el.textContent.trim()))
    /* The bottom bar's copies, not the sidebar's - taken by position. */
    .filter(el => el.getBoundingClientRect().top > window.innerHeight * 0.75);
  return {
    bannerShown: !!banner,
    bannerFullyOnScreen: banner
      ? banner.getBoundingClientRect().bottom <= window.innerHeight + 1 &&
        banner.getBoundingClientRect().top >= 0
      : null,
    navCount: nav.length,
    blocked: nav.map(el => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
      const reachable = !!(top && (el === top || el.contains(top) || top.contains(el)));
      return reachable ? null : el.textContent.trim();
    }).filter(Boolean),
  };
});

section('On a phone, the banner is showing and the bar is still tappable');
{
  await freshVisit(390, 844);
  const v = await probe();
  ok(v.bannerShown, 'the consent banner is up, which is the state being tested', v.bannerShown);
  ok(v.navCount === 4, 'all four bottom-nav buttons are on screen', v.navCount);
  ok(v.blocked.length === 0,
     'and none of them is covered by the banner', v.blocked);
  ok(v.bannerFullyOnScreen,
     'while the banner itself is still fully visible, not pushed off the top or bottom',
     v.bannerFullyOnScreen);
}

section('The small tablet the two rules used to disagree about');
{
  /* The banner's own mobile rule stopped at 640px and the bottom bar starts at
     720px, so 641-720 had the bar visible and the banner still at its desktop
     offset, sitting on it. That gap is why this width is checked and not just
     a phone. */
  await freshVisit(700, 900);
  const v = await probe();
  ok(v.bannerShown, 'the banner is up here too', v.bannerShown);
  ok(v.navCount === 4, 'the bottom bar is shown at this width', v.navCount);
  ok(v.blocked.length === 0, 'and it is not covered either', v.blocked);
}

section('On a desktop there is no bar, and the banner sits where it always did');
{
  await freshVisit(1280, 900);
  const v = await page.evaluate(() => {
    const vis = el => { const c = getComputedStyle(el), b = el.getBoundingClientRect();
      return c.display !== 'none' && c.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
    const banner = [...document.querySelectorAll('div,section,aside')]
      .find(d => vis(d) && /Essential cookies keep AMV running/.test(d.textContent) && d.children.length < 8);
    const nav = document.getElementById('bottom-nav');
    return {
      shown: !!banner,
      gapFromBottom: banner ? Math.round(window.innerHeight - banner.getBoundingClientRect().bottom) : null,
      navHidden: !nav || getComputedStyle(nav).display === 'none',
    };
  });
  ok(v.shown, 'the banner still shows on a desktop', v.shown);
  ok(v.navHidden, 'where there is no bottom bar to avoid', v.navHidden);
  ok(v.gapFromBottom !== null && v.gapFromBottom < 40,
     'so it stays near the bottom rather than floating up for no reason', v.gapFromBottom);
}

section('And it does not cover a dialog either, which is what the lift caused');
{
  /* THE SECOND HALF OF THE SAME BUG. Lifting the banner by the height of the
     bar moved it from 722-844 to 650-772 on this screen - out of the nav and
     into the band where a TALL modal's action row sits.

     Measured on Build's consent dialog, which is the one where somebody hands
     an autonomous agent their machine for a whole turn: the centre of both
     "Let it work" and "Not now" returned the banner, leaving a ~23px strip of
     each button that still worked. Short dialogs were never affected, so this
     drives the tall one on purpose.

     Reachability again, not geometry - the boxes overlapping was visible in a
     screenshot the whole time and read as "a banner at the bottom". */
  await freshVisit(390, 844);
  const st = await page.evaluate(() => {
    window.BRIDGE = { connected: true, folder: 'my-app' };
    window.BRIDGE_TOOLS = [{ name: 'run_command' }];
    try { _agentConsent('add a login page and run the tests'); } catch (e) { return { opened: false, why: String(e && e.message) }; }
    return { opened: true };
  });
  ok(st.opened, 'the whole-turn consent dialog opens', st);
  await page.waitForTimeout(700);

  const d = await page.evaluate(() => {
    const desc = el => el ? (el.tagName + '.' + String(el.className || '').split(' ')[0]) : 'null';
    const hit = (el) => { const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { own: !!(t && (t === el || el.contains(t))), took: desc(t), top: Math.round(r.top) }; };
    const okB = document.getElementById('modal-ok'), noB = document.getElementById('modal-cancel');
    const cc = document.getElementById('cookie-consent-banner');
    return { ok: okB ? hit(okB) : null, cancel: noB ? hit(noB) : null,
             bannerStanding: !!cc, bannerVisible: cc ? getComputedStyle(cc).visibility : null };
  });
  ok(d.ok && d.ok.own,
     'the button that GRANTS an autonomous turn takes its own tap', d.ok);
  ok(d.cancel && d.cancel.own,
     'and so does the one that refuses - a person who wants out can get out', d.cancel);
  ok(d.bannerStanding, 'the banner is still on the page, not destroyed', d.bannerStanding);
  ok(d.bannerVisible === 'hidden',
     'it just stands down while something is blocking the page', d.bannerVisible);

  /* And it comes back, because standing down permanently would be a consent
     banner somebody never answered. */
  await page.evaluate(() => { const b = document.getElementById('modal-cancel'); if (b) b.click(); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const cc = document.getElementById('cookie-consent-banner');
    return cc ? getComputedStyle(cc).visibility : null;
  });
  ok(after === 'visible', 'and it is back the moment the dialog closes', after);
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

report('consent banner vs nav');
done();
