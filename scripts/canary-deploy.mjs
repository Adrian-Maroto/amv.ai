#!/usr/bin/env node
/* A NEW WORKER SERVES A FEW PEOPLE BEFORE IT SERVES EVERYBODY (Oct 31 audit,
   item 83: canary deployments; item 84 is the rollback half of it).

   `wrangler deploy` replaces the live Worker for every request at once, so a
   version that cannot reach its store or its engine is wrong for everybody
   for as long as it takes somebody to notice. This uses Workers gradual
   deployments instead:

     1. upload the new version without sending it any traffic;
     2. send it CANARY_PERCENT of requests, the version that was serving
        keeping the rest;
     3. ask /v1/health/ready of THE NEW VERSION ITSELF, pinned with the
        Cloudflare-Workers-Version-Overrides header, again and again for
        CANARY_WATCH_SECONDS - so the answer is about the canary and not
        about whichever version the request happened to land on;
     4. any "not ready" that a retry does not clear puts the old version back
        at 100% and fails; otherwise the new one goes to 100% and the cron
        schedule in wrangler.toml is applied (`versions deploy` does not
        apply triggers - only `wrangler deploy` does).

   A version with a Durable Object migration cannot be uploaded this way -
   Cloudflare applies migrations only through `wrangler deploy` - so for that
   one release this says so and deploys the ordinary way. So does the very
   first deploy, when there is no serving version to fall back to.

   The workflow runs it only when the repository variable AMV_CANARY is on;
   otherwise deploys are exactly what they were. WRANGLER, AMV_READY_URL and
   the timing are read from the environment so the test can drive every
   branch against a stand-in without a Cloudflare account. */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRANGLER = (process.env.WRANGLER || 'npx wrangler').split(' ').filter(Boolean);
const READY_URL = process.env.AMV_READY_URL || 'https://api.amv.homes/v1/health/ready';
const WORKER = process.env.AMV_WORKER_NAME || 'amv-ai';
const PERCENT = Math.min(50, Math.max(1, Number(process.env.CANARY_PERCENT || 10)));
const WATCH_MS = Math.max(0, Number(process.env.CANARY_WATCH_SECONDS ?? 120)) * 1000;
const EVERY_MS = Math.max(0, Number(process.env.CANARY_CHECK_EVERY_SECONDS ?? 10)) * 1000;
const RETRY_MS = Math.max(0, Number(process.env.CANARY_RETRY_SECONDS ?? 5)) * 1000;
const SHA = String(process.env.GITHUB_SHA || 'local').slice(0, 7);

function say(line) { console.log(line); }
function summary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); } catch (e) { console.log('(could not write the run summary: ' + e.message + ')'); }
}
function wrangler(args, { show = true } = {}) {
  const r = spawnSync(WRANGLER[0], [...WRANGLER.slice(1), ...args], { encoding: 'utf8', env: process.env });
  const out = (r.stdout || '') + (r.stderr || '');
  if (show && out.trim()) process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  return { ok: r.status === 0, out };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* The version serving most traffic now. Read from the JSON wrangler prints,
   walked rather than addressed, so a field moving between wrangler releases
   reads as "unknown" (and a plain deploy) instead of as a wrong id. */
export function servingVersion(json) {
  let best = null;
  (function walk(v) {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const id = v.version_id || v.versionId;
    const pct = Number(v.percentage);
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && Number.isFinite(pct) && (!best || pct > best.pct)) best = { id, pct };
    Object.values(v).forEach(walk);
  })(json);
  return best ? best.id : '';
}
export function uploadedVersion(text) {
  const m = /Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(text || ''));
  return m ? m[1] : '';
}

async function readyOn(version) {
  try {
    const res = await fetch(READY_URL, { headers: { 'Cloudflare-Workers-Version-Overrides': WORKER + '="' + version + '"', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    let ready = false; try { ready = JSON.parse(body).ready === true; } catch (e) {}
    return { ready, status: res.status, body: body.slice(0, 300) };
  } catch (e) { return { ready: false, status: 0, body: e.message }; }
}

function plainDeploy(reason) {
  say('Deploying the ordinary way: ' + reason);
  summary(['### Deployed without a canary', '', reason]);
  return wrangler(['deploy']).ok ? 0 : 1;
}

async function main() {
  const st = wrangler(['deployments', 'status', '--json'], { show: false });
  let old = '';
  if (st.ok) { try { old = servingVersion(JSON.parse(st.out.slice(st.out.indexOf('{')))); } catch (e) {} }
  if (!old) return plainDeploy('no version is serving yet, or its id could not be read, so there is nothing to fall back to.');
  say('Serving now: ' + old);

  const up = wrangler(['versions', 'upload', '--message', 'canary ' + SHA, '--tag', SHA]);
  if (!up.ok) {
    if (/migration/i.test(up.out)) return plainDeploy('this release carries a Durable Object migration, which Cloudflare applies only through a full deploy.');
    say('::error title=Upload failed::The new version could not be uploaded. Nothing changed: ' + old + ' still serves everybody.');
    return 1;
  }
  const neu = uploadedVersion(up.out);
  if (!neu) { say('::error title=No version id::The upload succeeded but printed no version id. Nothing changed: ' + old + ' still serves everybody.'); return 1; }

  if (!wrangler(['versions', 'deploy', neu + '@' + PERCENT + '%', old + '@' + (100 - PERCENT) + '%', '--yes', '--message', 'canary ' + SHA]).ok) {
    say('::error title=Canary not started::Could not split traffic. ' + old + ' still serves everybody.');
    return 1;
  }
  say('Canary: ' + neu + ' serves ' + PERCENT + '% of requests. Watching it for ' + Math.round(WATCH_MS / 1000) + 's.');

  const until = Date.now() + WATCH_MS;
  let checks = 0;
  for (;;) {
    let r = await readyOn(neu);
    if (!r.ready) { await sleep(RETRY_MS); r = await readyOn(neu); }
    checks++;
    if (!r.ready) {
      say('The canary is not ready (HTTP ' + r.status + '): ' + r.body);
      const back = wrangler(['versions', 'deploy', old + '@100%', '--yes', '--message', 'canary ' + SHA + ' was not ready - previous version back']);
      if (back.ok) {
        say('::error title=Canary refused::' + SHA + ' was not ready on ' + PERCENT + '% of traffic, so ' + old + ' serves everybody again.');
        summary(['### Canary refused', '', SHA + ' served ' + PERCENT + '% of requests and was not ready, so the previous version is back at 100%.', '', '```', r.body, '```']);
      } else {
        say('::error title=Could not put the previous version back::Run: npx wrangler versions deploy ' + old + '@100% --yes. docs/INCIDENT-RUNBOOK.md.');
      }
      return 1;
    }
    if (Date.now() >= until) break;
    await sleep(EVERY_MS);
  }

  if (!wrangler(['versions', 'deploy', neu + '@100%', '--yes', '--message', 'release ' + SHA]).ok) {
    say('::error title=Not promoted::The canary was ready but could not be moved to 100%. Traffic is still split ' + PERCENT + '/' + (100 - PERCENT) + '. Run: npx wrangler versions deploy ' + neu + '@100% --yes');
    return 1;
  }
  if (!wrangler(['triggers', 'deploy']).ok) {
    say('::error title=Schedule not applied::' + neu + ' serves everybody but the cron schedule could not be applied. Run: npx wrangler triggers deploy');
    return 1;
  }
  say('Released: ' + neu + ' serves everybody after ' + checks + ' ready checks on ' + PERCENT + '% of traffic.');
  summary(['### Released through a canary', '', SHA + ' served ' + PERCENT + '% of requests, answered ready ' + checks + ' times, and now serves everybody.']);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(code => process.exit(code), e => { console.error(e); process.exit(1); });
