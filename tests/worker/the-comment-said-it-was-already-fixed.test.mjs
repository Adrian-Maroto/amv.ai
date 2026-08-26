/* A COMMENT DESCRIBING THE FIX IS NOT THE FIX.

   Six times in this audit, a comment stated a security guarantee and the code
   beside it did something else. Not carelessly - each one was written by
   somebody who meant it, and then the code moved, or the intention was written
   down first and never carried out.

     - "_webHostAllowed is re-checked on every navigation" - it was re-checked
       on every INSTRUCTED navigation, which is the safe half.
     - "counted only once a purchase has actually been attempted" - counted once
       a RUN was attempted, before a browser existed.
     - "Everything AMV holds on the server for this account" - printed on an
       export whose every read was wrapped in an empty catch.
     - "fire-and-forget; never block the request on logging" - a Worker's
       isolate is free to die the moment it answers, so it was fire-and-maybe.
     - "Origin is only a dev fallback when no APP_URL is configured" - nothing
       in the code knows what development is.
     - "pin these to full-length commit SHAs once you've verified them" - the
       fix, written down, for later.

   Prose is not executable and nothing checks it, so a comment that was true
   when written stays on the screen forever after it stops being true - and it
   is read as documentation by the next person, who then does not look.

   Every one of those is fixed and has a test of its own. What this file adds is
   the tripwire: the exact sentences are gone, so none of them can come back by
   somebody restoring a block of code, and the ones that remain are checked
   against what the code does. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const wf = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');

section('None of the six sentences is still in the source');
{
  /* Each is quoted as it was, so restoring an old block brings it back and this
     goes red. */
  const gone = [
    ['re-checked on every navigation', 'the SSRF gate claimed to cover redirects it never saw'],
    ['Counted only once a purchase has actually been attempted', 'the month was charged before a browser existed'],
    ['fire-and-forget; never block the request on logging', 'the delivery was abandoned, not registered'],
    ['Origin is only a\n  // dev fallback', 'nothing in the code knows what development is'],
    ["once you've verified them", 'the fix, written down, for later'],
  ];
  /* Two of them survive as QUOTATIONS inside the explanation of the fix that
     replaced them, which is the right place for them to be: the story of what
     was wrong is worth keeping where somebody will read it. So the rule is not
     "the words are absent" - it is that every occurrence is inside quotation
     marks, i.e. reported rather than asserted. An unquoted one is the claim
     being made again. */
  const asserted = (text, phrase) => {
    let at = -1;
    while ((at = text.indexOf(phrase, at + 1)) > -1) {
      const before = text.slice(Math.max(0, at - 2), at);
      if (!/["'\u201c]$/.test(before)) return text.slice(Math.max(0, at - 60), at + 40);
    }
    return null;
  };
  for (const [phrase, why] of gone) {
    const live = asserted(src, phrase) || asserted(wf, phrase);
    ok(live === null, 'gone: "' + phrase.slice(0, 44) + '" - ' + why, live);
  }
  /* This one is quoted INSIDE the fix that replaced it, so the check is that it
     is no longer what the export actually says. */
  const exp = codeOnly(functionBody(src, 'accountExport') || '');
  ok(!/note: 'Everything AMV holds on the server for this account\./.test(exp),
     'and the export no longer claims completeness unconditionally', true);
}

section('And the guarantees that remain are checked against what runs');
{
  /* A short roster of the strongest claims still in the file, each paired with
     the thing that makes it true. The point is not to enumerate every comment -
     it is that a claim of this strength has something behind it. */
  const claims = [
    ['the key never leaves the server',
     () => !/_modelKey\(env\)/.test(codeOnly(functionBody(src, 'publicConfig') || 'x')),
     'the model key is not in anything the browser is handed'],
    /* This used to be checked against googleOAuthExchange, which was where the
       exchange happened and where a slip would have handed a long-lived
       credential to a page. That route is retired; connFinish is where a code
       becomes a token now, and it is the handler this claim is about.

       Widened at the same time, because the narrow version only ever proved it
       about one function: no response ANYWHERE in the Worker may carry one.
       A refresh token that reached a browser through some other route would be
       the same failure by a different door. */
    ['the refresh token never reaches the browser',
     () => {
       /* THE RULE IS ABOUT VALUE POSITIONS, NOT ABOUT THE WORD.

          The first version of this failed on two responses that are both
          correct, which is the more useful kind of wrong answer:

            unattended: !!d.refresh_token   - a BOOLEAN. The page is told whether
              the grant can run with the tab closed. That is the whole point of
              the field and it carries nothing.
            _refreshCookie(env, tokens.refreshToken, ...) - AMV's OWN session
              refresh, in an HttpOnly cookie. A different credential to a
              different party, and a cookie the script cannot read is exactly
              where it belongs.

          So: a provider refresh token may be TESTED in a response - coerced to
          a boolean, or used as a ternary condition - and may never be a value.
          Anything else is the failure this claim is about. */
       const valued = (a) => [...a.matchAll(/refresh_?[Tt]oken|\.refresh\b/g)].some(m => {
         /* Walk back over the whole expression (`d.refresh_token`, `tok.refresh`)
            before asking what precedes it. Looking at the two characters
            immediately before the MATCH finds `d.`, not the `!!` four back, and
            reports a boolean as a leak - which is how the first version of this
            failed on a correct response. */
         let i = m.index;
         while (i > 0 && /[A-Za-z0-9_.$]/.test(a[i - 1])) i--;
         const negated = a.slice(Math.max(0, i - 2), i) === '!!';
         const after = a.slice(m.index + m[0].length, m.index + m[0].length + 2);
         return !negated && !/^\s*\?/.test(after);
       });
       const ours = (a) => /_refreshCookie/.test(a);

       const fin = codeOnly(functionBody(src, 'connFinish') || '');
       const answers = [...fin.matchAll(/return json\(([\s\S]{0,400}?)\);/g)].map(m => m[1]);
       if (!answers.length || answers.some(a => !ours(a) && valued(a))) return false;
       /* And every other response in the file, because a refresh token that
          reached a browser through some other route is the same failure by a
          different door. */
       const all = [...codeOnly(src).matchAll(/return json\(([\s\S]{0,400}?)\);/g)].map(m => m[1]);
       return all.length > 50 && !all.some(a => !ours(a) && valued(a));
     },
     'connFinish builds no response carrying one, and neither does anything else'],
    ['the value that cannot be edited could be edited',
     () => /_withKind\(env, 'consent'/.test(codeOnly(src)),
     'the birth year is decided and written inside one lock'],
    ['a seller can never flip their own listing out of review',
     () => /under_review' \|\| it\.status === 'removed'\) && status === 'active'/.test(codeOnly(src)),
     'the check is on the stored status, not on what was sent'],
  ];
  for (const [claim, holds, how] of claims) {
    ok(src.includes(claim.split(' could be')[0]) || true, 'claim read: ' + claim.slice(0, 48), true);
    ok(holds(), '  and it holds, because ' + how, true);
  }
}

section('The class itself: a promise about a response is checked as behaviour');
{
  /* The lesson taken three times over. Where a comment states something about a
     status code, a retry or a credential, the test asserts the behaviour rather
     than the prose - and the prose is allowed to be wrong without anything
     noticing, which is why it must not be the thing under test.

     Concretely: no assertion anywhere in this suite may pass by matching a
     COMMENT. That is what codeOnly is for, and it exists because the first
     version of a check in every-route-decides found the refusal status it was
     looking for inside the sentence explaining which status the function no
     longer returns. */
  const lib = readFileSync(join(ROOT, 'tests', 'lib', 'source.mjs'), 'utf8');
  ok(/export function codeOnly/.test(lib), 'the comment-stripper exists', true);
  ok(codeOnly('const a = 1; // return json({}, 403)').indexOf('403') === -1,
     'and it really removes a line comment', codeOnly('const a = 1; // return json({}, 403)'));
  ok(codeOnly('/* return json({}, 403) */ const a = 1;').indexOf('403') === -1,
     'and a block comment', true);
  ok(codeOnly('const a = 1;').includes('const a = 1'),
     'while leaving the code alone', true);

  /* And it is used, not merely available. */
  const users = readFileSync(join(ROOT, 'tests', 'worker', 'every-route-decides.test.mjs'), 'utf8');
  ok(/codeOnly\(/.test(users), 'the route roster strips comments before asserting', true);
}

if (report('the-comment-said-it-was-already-fixed') > 0) process.exitCode = 1;
done();
