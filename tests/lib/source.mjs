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

/* THE SAME TEXT, WITH THE PROSE TAKEN OUT.

   A check that reads source can be satisfied by a COMMENT, and that is not a
   theoretical worry - it happened here. A new assertion read _adminGate and
   asked whether it refuses, by looking for the refusal status. It passed. The
   status in the code was 403; the only "401" in the function was the sentence
   explaining why it is NOT 401 any more. The check was green because of the
   paragraph written to explain the change it was supposed to notice.

   This codebase comments heavily and deliberately, which makes the hazard
   bigger here than in most: the more carefully a decision is written down, the
   more likely the words describing it satisfy a grep looking for it. Any check
   asserting that CODE does something should ask this for the text first.

   Comments only. String and template literals stay, because a great many of
   these checks legitimately look for a key prefix or a message inside one.

   Regex literals have to be recognised even though they are kept, because
   `/['"]/ ` and `/https?:\/\//` both contain characters that would otherwise
   start a string or a comment and swallow the rest of the file. Whether a `/`
   opens a regex or divides is decided by what precedes it, which is the same
   rule a JavaScript tokeniser uses. Running this over the whole Worker and
   re-checking the result with `node --check` is how that was confirmed - a
   version that got it wrong produced a file that no longer parsed. */
/* Comments blanked, and OPTIONALLY the insides of string literals too.

   `codeOnly` keeps strings on purpose: most callers are looking for one. But a
   rule that scans for "a name followed by a paren" cannot tell `Handoffs (` in
   a sentence from a call, and a rule that counts braces cannot survive a `{`
   inside a message. Both need the strings gone.

   It is an option on THIS scanner rather than a second pass over its output,
   because the second pass is the thing that goes wrong: a regex literal
   containing a quote - /['"]/g - starts a string that never ends, and from
   there the blanker eats real code. That was tried, and it silently swallowed
   the very call the rule was being widened to catch. This scanner already has
   to tell a regex from a division to find comments at all, so it is the only
   place that knows. */
export function codeOnly(text, opts) {
  const BLANK_STRINGS = !!(opts && opts.blankStrings);
  /* WHERE THE SCAN FINISHED, REPORTED RATHER THAN INFERRED.

     Everything structural in this repository trusts this function, so
     something has to prove it kept its place. That proof used to be "the
     number of backticks left in the output is even", on the theory that an
     odd count means the scan ended inside a template.

     It does not. This codebase contains a hundred and ninety-one lines with
     a lone backtick inside a regex character class - `.replace(/[#*`]/g,'')`
     and its relatives - all of them correctly scanned code. The parity was
     even by coincidence, and adding one more correct line of the same kind
     turned the proof red while a real desync that happened to move the count
     by two would leave it green.

     So the scanner says so itself. `opts.state` is filled in with what it was
     doing when it ran out of file, which is the actual question. */
  const state = opts && opts.state;
  if (state) { state.endedIn = 'code'; state.unterminated = null; }
  const note = (what, at) => {
    if (state && state.endedIn === 'code') { state.endedIn = what; state.unterminated = at; }
  };
  const n = text.length;
  const out = [];
  /* The last significant character emitted. It is what decides whether the next
     `/` opens a regex or divides - `x = /re/` versus `a / b`. */
  let prev = '';
  /* A short rolling window of what was just emitted, so `return /re/` and
     `case /re/` are told apart from `a / b`, which one previous character
     cannot do. */
  let recent = '';
  const remember = (t) => { recent = (recent + t).slice(-24); };
  const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$.])(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/;

  scan(0, false);
  return out.join('');

  /* One scanner, used for the file and for the inside of every ${ }. They are
     the same language, and writing a second simpler loop for substitutions is
     how a regex containing a quote - `${s.replace(/['"]/g, '')}` - starts a
     string that never ends. Returns the index just past the stopping point.

     stopAtBrace: consume up to the matching `}` and return past it. */
  function scan(from, stopAtBrace) {
    let i = from, depth = 0;
    while (i < n) {
      const c = text[i], d = text[i + 1];

      if (c === '/' && d === '*') {
        const end = text.indexOf('*/', i + 2);
        const cut = end < 0 ? n : end + 2;
        /* Blanked rather than removed, so every line number and column in the
           result still lines up with the file it came from. */
        out.push(text.slice(i, cut).replace(/[^\n]/g, ' '));
        remember(' '); i = cut; continue;
      }
      if (c === '/' && d === '/') {
        const end = text.indexOf('\n', i);
        const cut = end < 0 ? n : end;
        out.push(' '.repeat(cut - i));
        remember(' '); i = cut; continue;
      }
      if (c === '/') {
        /* A regex literal. Kept whole - it is code - but it has to be
           RECOGNISED, because the quotes and slashes inside one would otherwise
           be read as a string or a comment and eat the rest of the file. */
        const isRegex = prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) ||
                        KEYWORD_BEFORE_REGEX.test(recent);
        if (isRegex) {
          let j = i + 1, cls = false, closed = false;
          for (; j < n; j++) {
            const ch = text[j];
            if (ch === '\\') { j++; continue; }
            if (ch === '\n') break;                 // not a regex after all
            if (cls) { if (ch === ']') cls = false; continue; }
            if (ch === '[') { cls = true; continue; }
            if (ch === '/') { closed = true; break; }
          }
          if (closed) {
            j++;
            while (j < n && /[dgimsuvy]/.test(text[j])) j++;   // flags
            const lit = text.slice(i, j);
            out.push(lit); remember(lit); prev = '/'; i = j; continue;
          }
        }
        out.push(c); remember(c); prev = c; i++; continue;
      }

      if (c === '"' || c === "'") {
        /* Copied intact - a quote inside it must not open another literal, and
           `//` inside a URL is not a comment. */
        let j = i + 1, done = false;
        for (; j < n; j++) {
          if (text[j] === '\\') { j++; continue; }
          if (text[j] === c) { j++; done = true; break; }
          if (text[j] === '\n') break;              // unterminated: bail out
        }
        if (!done && j >= n) note('string', i);
        const lit = text.slice(i, j);
        /* The quotes are kept so the shape of the code survives; only what is
           between them becomes spaces, and newlines are preserved so every
           line number still lines up with the file. */
        out.push(BLANK_STRINGS ? lit.replace(/[^\n'"]/g, ' ') : lit);
        remember(lit); prev = c; i = j; continue;
      }

      if (c === '`') { i = template(i); continue; }

      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) { out.push('}'); prev = '}'; return i + 1; }
          depth--;
        }
      }

      out.push(c); remember(c);
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return i;
  }

  /* A template literal, from its opening backtick, returning the index just
     past its close. The text is emitted verbatim; the code inside each ${ }
     goes back through scan(), so comments there are stripped and a nested
     template is handled exactly like any other.

     Skipping a template by looking for the next backtick is what an earlier
     version did, and it is wrong the moment one template contains another -
     `${a ? `x` : `y`}` - which this app's HTML builders do constantly. The
     scan then ends the outer literal on the INNER opening backtick, every
     backtick after it is off by one, and the scanner believes it is inside a
     string for thousands of lines. Not a theoretical drift: it left real block
     comments in app.js unstripped from line 9712 on, and because the mistake
     makes MORE text look like a string, it fails in the direction of passing. */
  function template(start) {
    out.push('`'); remember('`');
    let i = start + 1;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') { out.push(text.slice(i, i + 2)); i += 2; continue; }
      if (ch === '`') { out.push('`'); prev = '`'; return i + 1; }
      if (ch === '$' && text[i + 1] === '{') {
        out.push('${'); remember('${'); prev = '{';
        i = scan(i + 2, true);
        continue;
      }
      out.push(ch); i++;
    }
    prev = '`';
    /* Unterminated. It IS this helper's job to say so - not to repair the
       file, but so the suite that proves this scanner keeps its place can ask
       a direct question instead of counting characters. */
    note('template', start);
    return i;
  }
}

/* The same thing including the declaration line, for checks that care about the
   signature or about a comment attached to the function. */
export function functionSource(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (!m) return '';
  const body = functionBody(src, name);
  return body ? src.slice(m.index, src.indexOf('{', m.index + m[0].length)) + body : '';
}
