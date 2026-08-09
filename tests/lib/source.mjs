/* READING A FUNCTION OUT OF THE SOURCE, WITHOUT GUESSING WHERE IT ENDS.

   A lot of checks here are about code rather than behaviour - "this guard is
   inside that handler", "the cron reads these records". They all need the same
   thing: the text of one named function.

   The way that was written, over and over, was a fixed character window:

       src.slice(src.indexOf('async function runDueAutomations'), at + 800)

   which is wrong in both directions and silently. Too small, and it misses the
   line it is looking for the moment somebody adds a comment above it - that has
   now failed two gate runs on correct code, which is the failure mode that
   teaches people to stop trusting this directory. Too large, and it reads into
   the NEXT function, so a check passes because of a line that has nothing to do
   with the thing being checked.

   Both were live. `invest-checkin` sliced 4000 characters to find a guard;
   `routes-exist` sliced 800. Neither number meant anything.

   So: count braces. The body ends exactly where the function ends, which is a
   fact about the code rather than a number somebody picked. */

/* The text of a named function.

   NOT by counting braces. That was the first attempt and it is wrong in a way
   worth writing down: a brace inside a STRING, a regex or a comment closes the
   function early, and the naive counter stopped 1200 characters into
   `widgetChat` - which would have quietly shrunk several checks to a fraction
   of the code they claim to cover. Counting braces correctly means tokenising
   JavaScript, which is not what a test helper should be doing.

   What is reliable here is the file's own shape: these are top-level function
   declarations, so one ends where the next begins, and its closing brace is a
   `}` in column 0. Both facts are structural rather than numeric, so neither
   drifts when somebody adds a comment.

   Returns '' when there is no such function, so a caller that names one wrongly
   gets an empty string and a failing assertion rather than a silent pass on a
   window that happened to contain something. */
export function functionBody(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (!m) return '';
  const open = src.indexOf('{', m.index + m[0].length);
  if (open < 0) return '';
  /* A one-liner - `function _role(team, email){ ... }` - has no closing brace in
     column 0 to anchor on. Its whole body is on the declaration line, where
     counting braces IS safe because the span is one line and ends with it. */
  const lineEnd = src.indexOf('\n', open);
  if (lineEnd > open) {
    const line = src.slice(open, lineEnd);
    let d = 0, endOnLine = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '{') d++;
      else if (line[j] === '}') { d--; if (d === 0) { endOnLine = j; break; } }
    }
    /* Nothing but whitespace or a trailing `//` comment may follow, or this is
       a multi-line body that merely happens to balance early on line one. */
    if (endOnLine >= 0 && /^\s*(\/\/.*)?$/.test(line.slice(endOnLine + 1)))
      return line.slice(0, endOnLine + 1);
  }

  /* Where the next top-level declaration starts - a hard ceiling, so a body can
     never run into the following function's code. */
  const nexts = [src.indexOf('\nasync function ', open), src.indexOf('\nfunction ', open)].filter(i => i > 0);
  const ceiling = nexts.length ? Math.min(...nexts) : src.length;
  /* The last close-brace in column 0 before that: this function's own end.
     Anything after it and before the next declaration is comment or blank.

     It must be a bare `}` on its own line - a top-level `const X = { ... };`
     between two functions ends `};`, and a plain lastIndexOf('\n}') matches
     that too, which would pull a whole constant into the body. */
  let close = -1;
  const end = /\n\}(?=\r?\n|$)/g;
  end.lastIndex = open;
  for (let mm; (mm = end.exec(src)) && mm.index < ceiling; ) { close = mm.index; break; }
  if (close > open) return src.slice(open, close + 2);

  /* No closing brace in column 0 before the next declaration - a body whose
     `}` is indented or shares a line with code. Fall back to counting braces,
     hard-capped at the next declaration so it can still never read into the
     following function. Counting can stop early on a brace inside a string, so
     this is the last resort rather than the rule, and it returns everything up
     to the ceiling rather than nothing if it fails outright. */
  let d = 0;
  for (let j = open; j < ceiling; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(open, j + 1); }
  }
  return src.slice(open, ceiling);
}

/* The same thing including the declaration line, for checks that care about the
   signature or about a comment attached to the function. */
export function functionSource(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (!m) return '';
  const body = functionBody(src, name);
  return body ? src.slice(m.index, src.indexOf('{', m.index + m[0].length)) + body : '';
}
