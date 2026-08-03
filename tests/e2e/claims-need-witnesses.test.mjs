/* A CONTROL MAY ONLY REPORT AN OUTCOME IT WAITED FOR.

   Seven controls in this product told the user something had happened without
   waiting to find out: a family invite said a code was sent, a link revoke said
   access stopped immediately, a handoff said it was sent to a person, a
   scheduled job said it was running, the emergency stop said nothing was
   running, approving said "Sent", and a review said it was posted.

   Every one was written by somebody being careful about something else. The
   shape is always identical and always invisible in review, because the request
   IS made - it is just not waited for:

       API.doTheThing(...).catch(()=>{});      // fired, forgotten
       toast('Done!', 'success');              // said anyway

   Six were found by reading. This is so the seventh is found by the gate.

   It reads the built bundle, because that is what ships, and it looks for a
   fire-and-forget call followed closely by a success-toned confirmation in the
   same function. Where a fire-and-forget call is genuinely right - analytics,
   audit logs, a view counter, a best-effort mirror of something already true
   locally - there is no claim afterwards, so nothing here fires. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const lines = bundle.split('\n');

/* A call whose failure is discarded. Not every one is wrong - only one followed
   by a claim. */
const FIRE_AND_FORGET = /(AMV_API\.[A-Za-z_]+\([^;]*\)|_fetch\([^;]*\)|fetch\([^;]*\))\s*\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/;

/* A definite statement that something HAS happened. Present-progressive
   ("Sending…", "Checking…") is not a claim, and neither is an error or an
   explicitly conditional line. */
const CLAIM = /toast\(\s*['"`][^'"`]*\b(sent|posted|published|scheduled|paused|resumed|stopped|removed|saved|added|deleted|revoked|approved|granted|linked|unlinked|disconnected|cancelled|canceled|updated|done)\b/i;
const SUCCESS_TONE = /,\s*['"`]success['"`]/;
const HEDGED = /\b(not |could not|couldn't|failed|NOT )/i;

/* How far a claim can sit from the call and still plainly belong to it. */
const WINDOW = 6;

section('The bundle is what gets checked');
{
  ok(lines.length > 10000, 'the built bundle was read', lines.length);
  const anyFF = lines.filter(l => FIRE_AND_FORGET.test(l)).length;
  /* If this ever hits zero the pattern has drifted and the check below is
     vacuous - which is the failure mode this repo has shipped before. */
  ok(anyFF > 0, 'and fire-and-forget calls are still recognised at all', anyFF);
}

section('No control claims an outcome it did not wait for');
{
  const offenders = [];
  lines.forEach((line, i) => {
    if(!FIRE_AND_FORGET.test(line)) return;
    for(let j = i; j < Math.min(lines.length, i + WINDOW); j++){
      const near = lines[j];
      if(!CLAIM.test(near)) continue;
      if(HEDGED.test(near)) continue;                 // says what did NOT happen
      if(!SUCCESS_TONE.test(near) && j !== i) continue;
      offenders.push((i + 1) + ': ' + line.trim().slice(0, 80) + '  ->  ' + near.trim().slice(0, 80));
      break;
    }
  });
  ok(offenders.length === 0,
     'every "it happened" is preceded by finding out that it did', offenders);
}

section('The controls that were fixed still wait');
{
  /* Named individually, so a future refactor that reverts one is caught even if
     it also happens to dodge the pattern above. */
  const fn = (name) => {
    const at = bundle.indexOf('function ' + name + '(');
    if(at < 0) return '';
    return bundle.slice(at, at + 2600);
  };
  const waits = [
    ['pauseAllAutonomous', /await _setAutonomyEverywhere\(/],
    ['_apvDoApprove',      /await AMV_API\.actApproval\(/],
    ['hoSend',             /await _hoDeliver\(/],
    ['_mcScheduleServer',  /await AMV_API\._fetch\(/],
  ];
  waits.forEach(([name, re]) => {
    const body = fn(name);
    ok(body.length > 0, name + ' is present in the bundle', body.length > 0);
    ok(re.test(body), name + ' waits for the thing it reports', name);
  });
}

section('And a genuine best-effort call is still allowed');
{
  /* The rule is about CLAIMS, not about awaiting everything. A view counter, an
     audit line or analytics has nothing to promise, and forcing those to be
     awaited would slow the product down for no honesty gained. */
  const viewCounter = /market\/view'[^\n]*\.catch\(\(\)=>\{\}\)/.test(bundle);
  ok(viewCounter, 'the listing view counter is still fire-and-forget, correctly', viewCounter);
}

if (report('claims-need-witnesses') > 0) process.exitCode = 1;
done();
