/* Measuring whether something overflows the screen.

   The obvious check - `documentElement.scrollWidth <= window.innerWidth` - is
   VACUOUS in this app, and quietly so. Both `html` and `body` carry
   `overflow-x: hidden`, so the document can never report a scroll width wider
   than the viewport no matter what is inside it. A 900px element on a 390px
   phone measures as zero overflow. Every assertion written that way passes
   unconditionally and proves nothing.

   Worse, the same CSS means real overflow is CLIPPED rather than scrollable, so
   content past the right edge is not merely awkward - it is unreachable.

   So overflow is measured from element geometry instead: what is actually
   sticking out, and by how much. Elements that scroll inside their own box
   (a wide table, a code block) are excluded, because that is the correct
   pattern rather than a defect. */

/* Returns { over, tag, cls, id } for the worst offender, or null when nothing
   overflows. Pass a Playwright page. */
export async function overflowingElement(page, opts = {}) {
  return page.evaluate(o => {
    const tol = o.tolerance || 2;
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      // Fixed/sticky chrome is positioned against the viewport on purpose.
      if (cs.position === 'fixed' || cs.position === 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Something that scrolls inside its own box is handling its own width.
      const scroller = el.closest('[style*="overflow"], .amv-scroll') ||
        (() => { let p = el.parentElement;
                 while (p && p !== document.body) {
                   const pcs = getComputedStyle(p);
                   if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') return p;
                   p = p.parentElement;
                 } return null; })();
      if (scroller) continue;
      const over = Math.round(r.right - window.innerWidth);
      if (over > tol && (!worst || over > worst.over)) {
        worst = { over, tag: el.tagName.toLowerCase(),
                  cls: String(el.className || '').slice(0, 60), id: el.id || '' };
      }
    }
    return worst;
  }, opts);
}

/* Convenience: true when nothing overflows. */
export async function fitsViewport(page, opts) {
  return (await overflowingElement(page, opts)) === null;
}
