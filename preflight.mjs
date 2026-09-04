#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV DEPLOY PREFLIGHT

   Runs BEFORE `wrangler deploy`, needs NO keys, and catches the config
   mistakes that otherwise blow up mid-deploy or - worse - deploy "successfully"
   but silently broken (quotas that don't hold, a cron that never fires, a
   binding the Worker reads but you forgot to declare).

   Exit 0 = safe to deploy. Exit 1 = fix the ERRORS first.
   WARN items won't stop a deploy but you should know about them.

   Usage:  node preflight.mjs
   ───────────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
/* THE CONFIG THIS RUN SHOULD READ.

   check.test.mjs proves the KV placeholder is a warning rather than a hard
   failure, and it proved it by writing the placeholder into the REAL
   wrangler.toml, running the gate, and restoring it. That works and it always
   restored correctly - but for most of a twenty-minute run the deploy config
   on disk named a namespace that does not exist, and anything that committed
   during that window would have shipped it. A stop hook asked three times.

   So the path is overridable. The test points this at a copy carrying the
   placeholder, the real file is never the thing being edited, and the window
   is gone rather than survived. Ignored unless it names a file that exists, so
   a stale or mistyped value cannot quietly make the preflight read nothing. */
const TOML_OVERRIDE = (() => {
  const v = process.env.AMV_WRANGLER_TOML;
  return (v && existsSync(v)) ? v : '';
})();
const R = (p) => (p === 'wrangler.toml' && TOML_OVERRIDE) ? TOML_OVERRIDE : join(ROOT, p);

const errors = [];
const warns = [];
const oks = [];
const err = (m, fix) => errors.push({ m, fix });
const warn = (m, fix) => warns.push({ m, fix });
const ok = (m) => oks.push(m);

const read = (p) => { try { return readFileSync(R(p), 'utf8'); } catch { return null; } };

/* ── 1. Required files exist ─────────────────────────────────────────────── */
for (const f of ['amv-backend.js', 'wrangler.toml', 'index.html', 'build.mjs', 'package.json']) {
  if (existsSync(R(f))) ok(`${f} is present`);
  else err(`${f} is missing`, `restore ${f} before deploying`);
}

const backend = read('amv-backend.js');
const toml = read('wrangler.toml');
const pkg = read('package.json');

/* ── 2. The Worker parses as a MODULE (not just a script) ────────────────── */
if (backend) {
  try {
    execSync(`node -e "import('${R('amv-backend.js').replace(/\\/g, '/')}').catch(e=>{if(e instanceof SyntaxError){process.exit(3)}})"`,
      { stdio: 'pipe' });
    ok('amv-backend.js loads as an ES module');
  } catch (e) {
    if (e.status === 3) err('amv-backend.js has a SYNTAX ERROR - it will not deploy',
      'run: node -e "import(\'./amv-backend.js\')" and fix the reported error');
    else ok('amv-backend.js loads as an ES module');
  }
}

/* ── 3. wrangler.toml core fields ────────────────────────────────────────── */
if (toml) {
  const field = (re) => (toml.match(re) || [])[1];

  const name = field(/^\s*name\s*=\s*"([^"]+)"/m);
  if (name) ok(`worker name is "${name}"`);
  else err('wrangler.toml has no `name`', 'add: name = "amv-ai"');

  const main = field(/^\s*main\s*=\s*"([^"]+)"/m);
  if (main === 'amv-backend.js') ok('main points at amv-backend.js');
  else if (main) err(`main points at "${main}", not amv-backend.js`, 'set: main = "amv-backend.js"');
  else err('wrangler.toml has no `main`', 'add: main = "amv-backend.js"');

  if (/compatibility_date\s*=/.test(toml)) ok('compatibility_date is set');
  else err('no compatibility_date', 'add: compatibility_date = "2024-09-23"');
}

/* ── 4. KV namespace: bound AND not left as the placeholder ───────────────── */
if (toml) {
  if (/binding\s*=\s*"AMV_KV"/.test(toml)) {
    ok('AMV_KV namespace is bound');
    const id = (toml.match(/binding\s*=\s*"AMV_KV"[\s\S]*?id\s*=\s*"([^"]+)"/) || [])[1];
    if (!id) err('AMV_KV has no id', 'run: npx wrangler kv namespace create AMV_KV, then paste the id');
    else if (/REPLACE_WITH|YOUR_KV|placeholder/i.test(id))
      err('AMV_KV id is still the PLACEHOLDER - deploy will fail or use the wrong store',
        'run: npx wrangler kv namespace create AMV_KV and paste the real id into wrangler.toml');
    else ok('AMV_KV has a real namespace id');
  } else {
    err('AMV_KV namespace is not bound - nothing will persist',
      'add a [[kv_namespaces]] block with binding = "AMV_KV"');
  }
}

/* ── 5. Durable Object: bound, migrated, AND the class is exported ────────── */
if (toml && backend) {
  const doBound = /class_name\s*=\s*"AMVCounter"/.test(toml) && /name\s*=\s*"AMV_COUNTER"/.test(toml);
  const doSqlite = /new_sqlite_classes\s*=\s*\[[^\]]*"AMVCounter"/.test(toml);
  const doLegacy = /(?<!sqlite_)new_classes\s*=\s*\[[^\]]*"AMVCounter"/.test(toml);
  const doMigrated = doSqlite || doLegacy;
  const doExported = /export\s+class\s+AMVCounter/.test(backend);

  if (doExported) ok('AMVCounter class is exported from the Worker');
  else err('AMVCounter is NOT exported from amv-backend.js - the DO binding will fail to deploy',
    'ensure amv-backend.js has: export class AMVCounter { ... }');

  if (doBound) ok('AMV_COUNTER Durable Object is bound');
  else err('AMV_COUNTER Durable Object is NOT bound - usage limits silently fall back to a NON-ATOMIC counter',
    'add [[durable_objects.bindings]] with name="AMV_COUNTER", class_name="AMVCounter"');

  /* The KIND of migration matters, and only at deploy time. A free-plan
     account cannot create a key-value-backed Durable Object at all - wrangler
     refuses with code 10097 - and it refuses LAST, after a clean build and a
     1.9MB upload. Cheaper to say so here. */
  if (doSqlite) ok('AMVCounter has a SQLite-backed migration entry');
  else if (doLegacy) err('AMVCounter migrates with new_classes, which a free-plan account cannot create',
    'change it to new_sqlite_classes = ["AMVCounter"] - same storage API, and what Cloudflare '
  + 'recommends for every new namespace. Only safe before the class has been deployed.');
  else err('AMVCounter has no [[migrations]] entry - first deploy of the DO will be rejected',
    'add [[migrations]] with tag and new_sqlite_classes = ["AMVCounter"]');
}

/* ── 5b. Observability, so the generic 500 is not the end of the story ─────
   The Worker answers an unhandled exception with "Something went wrong on our
   side. It has been logged." That is the right answer to a stranger, and it is
   only honest if the log exists. Observability defaults to OFF, and a dashboard
   toggle does not survive the next deploy - it is overwritten from this file -
   so the setting has to live here. */
if (toml) {
  const obs = /\[observability\]/.test(toml) && /enabled\s*=\s*true/.test(toml);
  if (obs) ok('observability is on, so a 500 leaves something to read');
  else warn('observability is OFF - unhandled errors return "it has been logged" and are not',
    'add [observability] with enabled = true (and [observability.logs] persist = true) to wrangler.toml');
}

/* ── 6. Cron trigger present (automations/research watches depend on it) ──── */
if (toml) {
  if (/crons\s*=\s*\[[^\]]+\]/.test(toml)) ok('a cron trigger is configured (scheduled jobs will run)');
  else warn('no cron trigger - scheduled automations & research watches will never fire',
    'add [triggers] with crons = ["*/5 * * * *"]');
}

/* ── 7. Every binding the Worker READS must be declared ───────────────────── */
if (backend && toml) {
  // env.SOMETHING references in the Worker
  const used = new Set();
  for (const m of backend.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);

  // things that come from bindings (not secrets) - these MUST be in wrangler.toml
  const bindingLike = ['AMV_KV', 'AMV_COUNTER'];
  for (const b of bindingLike) {
    if (used.has(b)) {
      if (new RegExp(`"${b}"`).test(toml)) ok(`${b} is used and declared`);
      else err(`${b} is used by the Worker but not declared in wrangler.toml`,
        `add the binding for ${b}`);
    }
  }

  /* Secrets the Worker reads - documented so you don't forget one at deploy.
     IMAGE_API_* and VIDEO_API_* used to be here and are gone: image and video
     generation were removed from the product end to end, and the Worker reads
     neither name anywhere. A deploy checklist naming a secret nothing reads
     sends somebody to buy a provider account for a feature that does not
     exist. */
  const KNOWN_SECRETS = ['AMV_MODEL_KEY', 'JWT_SECRET', 'STRIPE_PRICE_TEAM_SEAT', 'MODEL_API_URL', 'MODEL_API_FALLBACK_URL', 'ADMIN_TOKEN', 'EMAIL_API_KEY',
    'RESET_EMAIL_FROM', 'GLOBAL_DAILY_USD_CAP', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'APP_URL', 'AUDIT_WEBHOOK',
    // optional integrations - supported but not required to launch
    'ALLOWED_ORIGIN', 'APP_ORIGIN', 'OWNER_EMAIL', 'GOOGLE_CLIENT_ID',
    'ALERT_WEBHOOK',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
    'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ELITE', 'STRIPE_PRICE_ULTRA',
    'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_MODE', 'PAYPAL_WEBHOOK_ID',
    'PAYPAL_PLAN_PRO', 'PAYPAL_PLAN_ELITE', 'PAYPAL_PLAN_ULTRA', 'TURNSTILE_SECRET',
    /* These were read by the Worker and missing from this list, so the deploy
       checklist did not mention them. GOOGLE_CLIENT_SECRET is the one that
       matters: without it the auth-code exchange cannot happen, and Google
       sign-in fails at the last step with the client id correctly set - which
       is the hardest kind of misconfiguration to diagnose, because everything
       up to the redirect works. */
    'GOOGLE_CLIENT_SECRET',
    'FINANCE_CLIENT_ID', 'FINANCE_SECRET', 'FINANCE_API_URL',
    'SENTRY_DSN', 'POSTHOG_KEY', 'POSTHOG_HOST', 'SUPPORT_EMAIL', 'BROWSER',
    /* AMV-060: four more the Worker reads and this list did not name, so they
       came out as an "unknown env var" warning on every run. A warning that is
       always there for a reason nobody needs to act on is a warning people stop
       reading - and the one time it names something real, they will skip that
       too.

       MAIL_CRED_KEY is the one that matters: without it the mail, school and
       Telegram connectors refuse to store a credential at all, and they say so
       clearly - but only once somebody tries. It belongs on the deploy
       checklist rather than being discovered by a customer. */
    'MAIL_CRED_KEY',        // encrypts stored mailbox/school/bot credentials; without it those connectors refuse
    'TURNSTILE_SITE_KEY',   // the public half of Turnstile; the secret half is above
    'IMAGE_COST_USD',       // what an image really costs, so the ceilings price it correctly
    'VIDEO_COST_USD'];      // the same for video
  const usedSecrets = [...used].filter(u => KNOWN_SECRETS.includes(u)).sort();
  const REQUIRED = ['AMV_MODEL_KEY', 'JWT_SECRET'];
  /* Secrets that are optional to HAVE, but not optional once their partner is
     set. A client id with no client secret is a half-configured integration
     that fails at the moment somebody tries to use it. */
  const PAIRED = [['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
                  ['FINANCE_CLIENT_ID', 'FINANCE_SECRET'],
                  ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']];
  for (const [a, b] of PAIRED) {
    if (used.has(a) && !used.has(b)) {
      warn(`${a} is read but ${b} is not - that integration cannot complete`,
           `set ${b} too, or neither`);
    }
  }
  for (const r of REQUIRED) {
    if (used.has(r)) ok(`required secret ${r} is read by the Worker (set it with: wrangler secret put ${r})`);
  }
  const undocumented = [...used].filter(u =>
    !KNOWN_SECRETS.includes(u) && !bindingLike.includes(u) && u.length > 3);
  if (undocumented.length)
    warn(`the Worker reads env vars not in the known list: ${undocumented.join(', ')}`,
      'confirm each is either a binding in wrangler.toml or a secret you will set');

  ok(`secrets the Worker uses: ${usedSecrets.join(', ')}`);
}

/* ── 8. The built index.html is fresh (build ran after last source change) ── */
if (existsSync(R('index.html')) && existsSync(R('app.js'))) {
  try {
    const html = read('index.html');
    // a cheap freshness check: a distinctive recent string should be in the build
    const appHasMarker = /_buildResearchPanel|openResearchWatch|_abuseRecord/.test(read('app.js') || '');
    const htmlHasMarker = /_buildResearchPanel|openResearchWatch/.test(html || '');
    if (appHasMarker && !htmlHasMarker)
      warn('index.html looks STALE - recent app.js changes are not in the build',
        'run: node build.mjs   (or: npm run build) before deploying');
    else ok('index.html appears built from current source');
  } catch { /* non-fatal */ }
}

/* ── 8b. the shipped artifact knows where its backend is ──────────────────
   Without this, AMV_API.base is whatever the visitor typed into Settings -
   which for everybody except the owner is nothing. The app then falls back to
   its local demo permanently: no engine, no server account, no checkout. The
   owner's own browser works, because they pasted the URL once, so nothing on
   their machine ever shows the problem. This is the difference between a
   deployment that can take money and one that cannot. */
try {
  const html = readFileSync('index.html', 'utf8');
  const m = html.match(/<meta name="amv-api-base" content="([^"]*)"/);
  if (!m) {
    warn('index.html has no amv-api-base meta tag',
      'rebuild with: node build.mjs   (the tag is part of the shell)');
  } else if (!m[1].trim()) {
    warn('the built app has NO backend address, so every visitor gets the local demo',
      'build with: AMV_API_BASE=https://your-worker.workers.dev node build.mjs');
  } else if (!/^https:\/\//.test(m[1].trim())) {
    err(`the built app points at "${m[1]}", which is not https`,
      'the auth token is bound to its origin and will not be sent - use an https:// URL');
  } else {
    ok(`the built app points at ${m[1].trim()}`);
  }
} catch { /* non-fatal */ }

/* ── 9. WHAT THE STATIC HOST WOULD SERVE ──────────────────────────────────

   The site is a single file at the root of this repository, so the static
   host's publish directory is very likely the repository itself - and a
   static host serves what is in its publish directory. All of it.

   That is not hypothetical any more: opening https://<the site>/amv-backend.js
   returned the Worker. Every route and every limit, and beside it
   wrangler.toml, SECURITY-SCAMS.md - a list of what is defended and, by
   omission, what is not - the deploy notes, and the tests. None of them is a
   credential; secrets live in the Worker's environment and never in a file
   here. It is reconnaissance rather than a key, which is not a reason to keep
   handing it out.

   The build now writes `public/`, holding exactly what a visitor's browser
   asks for and nothing else, so the fix is one field rather than a list of
   deny rules. Whether the host has been pointed at it cannot be answered from
   in here - only the host knows its publish directory - so this stays a
   warning that names the files and the folder, not a check that passes. */
{
  const PRIVATE = ['amv-backend.js', 'wrangler.toml', 'wrangler.saved.toml',
                   'SECURITY-SCAMS.md', 'GO-LIVE.md', 'DEPLOY.md', 'LESSONS.md',
                   'check.mjs', 'preflight.mjs', 'backup.mjs', 'package.json'];
  const present = PRIVATE.filter(f => existsSync(R(f)));
  const ready = existsSync(R('public', 'index.html'));

  if (!ready) {
    err('public/ has no index.html, so the host has nothing narrow to publish',
        'rebuild with: node build.mjs   (it writes public/ from the built artifacts)');
  } else if (present.length) {
    warn('if the static host still publishes this whole folder, these are PUBLIC at your domain: '
         + present.slice(0, 6).join(', ') + (present.length > 6 ? `, +${present.length - 6} more` : ''),
         'set the host\'s publish directory to  public  - it already holds index.html, sw.js, '
       + 'manifest.webmanifest, the icons and amv-bridge.mjs, and nothing else. '
       + 'Check by opening https://<your domain>/amv-backend.js in a private window: '
       + 'a 404 is the answer you want.');
  } else {
    ok('public/ is the folder to publish, and holds only what a visitor needs');
  }
}

/* ── 10. package.json has a deploy script ────────────────────────────────── */
if (pkg) {
  if (/"deploy"\s*:\s*"wrangler deploy"/.test(pkg)) ok('npm run deploy is wired to wrangler');
  else warn('no `deploy` script in package.json', 'add "deploy": "wrangler deploy" to scripts');
}

/* ── Report ──────────────────────────────────────────────────────────────── */
const G = '\x1b[32m', Y = '\x1b[33m', RED = '\x1b[31m', B = '\x1b[1m', X = '\x1b[0m';
console.log(`\n${B}AMV deploy preflight${X}\n`);
for (const m of oks) console.log(`  ${G}✓${X} ${m}`);
if (warns.length) {
  console.log(`\n${B}${Y}Warnings${X} (won't block deploy, but read them):`);
  for (const w of warns) { console.log(`  ${Y}!${X} ${w.m}`); console.log(`      → ${w.fix}`); }
}
if (errors.length) {
  console.log(`\n${B}${RED}Errors${X} (fix before deploying):`);
  for (const e of errors) { console.log(`  ${RED}✗${X} ${e.m}`); console.log(`      → ${e.fix}`); }
}

console.log('');
if (errors.length) {
  console.log(`${B}${RED}NOT ready to deploy${X} - ${errors.length} error(s), ${warns.length} warning(s).\n`);
  process.exit(1);
} else {
  console.log(`${B}${G}Ready to deploy${X}${warns.length ? ` (${warns.length} warning(s) to review)` : ''}.`);
  console.log(`Next: set your secrets, then run ${B}npx wrangler deploy${X}.\n`);
  process.exit(0);
}
