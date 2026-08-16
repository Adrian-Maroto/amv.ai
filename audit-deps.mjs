/* AMV-SP-12: THE DEPENDENCY AUDIT NOBODY COULD REPRODUCE.
 *
 * The audit answer was "we could not run it here". That is not a finding about
 * the dependencies, it is a finding about the process: an audit that has to be
 * run by hand, in an environment somebody has to arrange, is one that gets run
 * once and then stops being run - and the whole value of it is that it happens
 * again next month, when a package that was clean today is not.
 *
 * So it is a script, it runs from the committed lockfile, and it has an
 * ACCEPTED list. Anything not on that list fails. That is the part that makes
 * this worth having: a new advisory in a dependency AMV already has will turn
 * this red without anybody deciding to look, and an accepted one has a written
 * reason beside it that somebody had to type.
 *
 * Run it with `node audit-deps.mjs`. It needs the network, so `npm run check`
 * treats being offline as a skip rather than a failure - a gate that goes red
 * on a train is a gate people learn to ignore.
 */
import { execSync } from 'child_process';

/* Advisories that have been looked at and accepted, each with the reason and
 * the date it was assessed. An entry here is a claim that the code path is not
 * reachable in what AMV actually deploys - not that the advisory is wrong.
 *
 * Reassess when the dependency changes, and delete the entry rather than
 * editing the reason: a stale reason attached to a live advisory is exactly the
 * comment-versus-code failure this project keeps finding.
 */
const ACCEPTED = {
  'extract-zip': {
    since: '2026-08',
    why: 'Symlink path traversal while EXTRACTING a downloaded browser archive. '
       + 'It is reached by @puppeteer/browsers when puppeteer downloads a browser. '
       + 'The Worker never does: @cloudflare/puppeteer connects to the Browser Rendering '
       + 'binding, and the deployed bundle contains no download path at all. '
       + 'The package is present because it is a transitive dependency of the fork, not '
       + 'because anything calls it.',
  },
  '@puppeteer/browsers': {
    since: '2026-08',
    why: 'Present only as the parent of extract-zip above, and unreachable for the same '
       + 'reason: nothing in a Worker downloads or extracts a browser.',
  },
  '@cloudflare/puppeteer': {
    since: '2026-08',
    why: 'Flagged solely because it depends on the two above. The only version npm offers '
       + 'as a "fix" is 0.0.11, which is OLDER than what is installed and loses real fixes - '
       + 'downgrading to make an audit quiet is worse than the advisory.',
  },
};

function audit() {
  try {
    const out = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (e) {
    /* npm audit exits non-zero when it FINDS something, and still prints the
       report. A parse failure is the real error. */
    const out = String((e && e.stdout) || '');
    if (out.trim().startsWith('{')) { try { return JSON.parse(out); } catch (_) {} }
    const msg = String((e && e.message) || e);
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|offline|ETIMEDOUT/i.test(msg + out)) {
      console.log('SKIP  the registry is not reachable, so no audit was run.');
      process.exit(0);
    }
    console.error('FAIL  npm audit could not be run or read:\n' + msg.slice(0, 800));
    process.exit(1);
  }
}

const report = audit();
const vulns = report.vulnerabilities || {};
const counts = (report.metadata && report.metadata.vulnerabilities) || {};

const unexpected = [];
for (const [name, v] of Object.entries(vulns)) {
  const sev = String(v.severity || '');
  if (sev === 'info' || sev === 'low') continue;
  if (ACCEPTED[name]) continue;
  unexpected.push({ name, severity: sev, range: v.range,
    titles: (v.via || []).map(x => (typeof x === 'string' ? x : x.title)).filter(Boolean) });
}

/* An accepted entry for something that is no longer flagged is a stale
 * exemption, and stale exemptions are how a roster stops meaning anything. */
const stale = Object.keys(ACCEPTED).filter(n => !vulns[n]);

console.log('npm audit: ' + JSON.stringify(counts));
for (const n of Object.keys(ACCEPTED)) {
  if (vulns[n]) console.log('  accepted: ' + n + '  (' + ACCEPTED[n].since + ')');
}

let bad = false;
if (unexpected.length) {
  bad = true;
  console.error('\nFAIL  advisories nobody has assessed:');
  for (const u of unexpected) {
    console.error('  ' + u.name + '  [' + u.severity + ']  ' + u.range);
    for (const t of u.titles.slice(0, 3)) console.error('      ' + t);
  }
  console.error('\nEither upgrade the dependency, or add it to ACCEPTED in audit-deps.mjs');
  console.error('with a written reason for why the code path cannot be reached here.');
}
if (stale.length) {
  bad = true;
  console.error('\nFAIL  ACCEPTED names something npm no longer flags: ' + stale.join(', '));
  console.error('Delete the entry - a reason attached to nothing is a reason nobody rechecks.');
}

if (bad) process.exit(1);
console.log('\nOK    every advisory is either absent or assessed.');
