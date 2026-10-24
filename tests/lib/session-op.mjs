/* The counter's five-hour 'session' ops (src/worker/07-atomic-counters.js),
   for a suite whose stand-in counter keeps its values in a Map. The count is
   kept under the counter's own name, so a suite that fills every
   `msgs5h:` value to the brim still fills the window; when it opened is kept
   beside it. Returns the answer, or null when `b` is not a session op. */
export function sessionOp(vals, n, b) {
  if (!b || !/^session(Get|Release)?$/.test(b.op || '')) return null;
  const now = Date.now(), windowMs = Number(b.windowMs) || 5 * 3600000;
  const startKey = '\u0000start:' + n;
  let start = vals.get(startKey), count = vals.get(n) || 0;
  const open = start != null && now - start < windowMs;
  if (b.op === 'sessionRelease') {
    if (start === b.start) vals.set(n, Math.max(0, count - (Number(b.amount) || 0)));
    return { value: vals.get(n) || 0 };
  }
  if (b.op === 'sessionGet') return open ? { value: count, start } : { value: 0, start: null };
  if (!open) { start = now; count = 0; vals.set(startKey, start); vals.set(n, 0); }
  if (count + (Number(b.amount) || 0) > b.cap) return { allowed: false, value: count, start };
  vals.set(n, count + (Number(b.amount) || 0));
  return { allowed: true, value: vals.get(n), start };
}
