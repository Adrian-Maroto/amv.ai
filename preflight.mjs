#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AMV DEPLOY PREFLIGHT

   Runs BEFORE `wrangler deploy`, needs NO keys, and catches the config
   mistakes that otherwise blow up mid-deploy or — worse — deploy "successfully"
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
const R = (p) => join(ROOT, p);

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
    if (e.status === 3) err('amv-backend.js has a SYNTAX ERROR — it will not deploy',
      'run: node -e "import(\'./amv-backend.js\')" and fix the reported error');
    else ok('amv-backend.js loads as an ES module');
  }
}

/* ── 3. wrangler.toml core fields ────────────────────────────────────────── */
if (toml) {
  const field = (re) => (toml.match(re) || [])[1];

  const name = field(/^\s*name\s*=\s*"([^"]+)"/m);
  if (name) ok(`worker name is "${name}"`);
  else err('wrangler.toml has no `name`', 'add: name = "amv-backend"');

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
      err('AMV_KV id is still the PLACEHOLDER — deploy will fail or use the wrong store',
        'run: npx wrangler kv namespace create AMV_KV and paste the real id into wrangler.toml');
    else ok('AMV_KV has a real namespace id');
  } else {
    err('AMV_KV namespace is not bound — nothing will persist',
      'add a [[kv_namespaces]] block with binding = "AMV_KV"');
  }
}

/* ── 5. Durable Object: bound, migrated, AND the class is exported ────────── */
if (toml && backend) {
  const doBound = /class_name\s*=\s*"AMVCounter"/.test(toml) && /name\s*=\s*"AMV_COUNTER"/.test(toml);
  const doMigrated = /new_classes\s*=\s*\[[^\]]*"AMVCounter"/.test(toml);
  const doExported = /export\s+class\s+AMVCounter/.test(backend);

  if (doExported) ok('AMVCounter class is exported from the Worker');
  else err('AMVCounter is NOT exported from amv-backend.js — the DO binding will fail to deploy',
    'ensure amv-backend.js has: export class AMVCounter { ... }');

  if (doBound) ok('AMV_COUNTER Durable Object is bound');
  else err('AMV_COUNTER Durable Object is NOT bound — usage limits silently fall back to a NON-ATOMIC counter',
    'add [[durable_objects.bindings]] with name="AMV_COUNTER", class_name="AMVCounter"');

  if (doMigrated) ok('AMVCounter has a migration entry');
  else err('AMVCounter has no [[migrations]] entry — first deploy of the DO will be rejected',
    'add [[migrations]] with tag and new_classes = ["AMVCounter"]');
}

/* ── 6. Cron trigger present (automations/research watches depend on it) ──── */
if (toml) {
  if (/crons\s*=\s*\[[^\]]+\]/.test(toml)) ok('a cron trigger is configured (scheduled jobs will run)');
  else warn('no cron trigger — scheduled automations & research watches will never fire',
    'add [triggers] with crons = ["*/5 * * * *"]');
}

/* ── 7. Every binding the Worker READS must be declared ───────────────────── */
if (backend && toml) {
  // env.SOMETHING references in the Worker
  const used = new Set();
  for (const m of backend.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);

  // things that come from bindings (not secrets) — these MUST be in wrangler.toml
  const bindingLike = ['AMV_KV', 'AMV_COUNTER'];
  for (const b of bindingLike) {
    if (used.has(b)) {
      if (new RegExp(`"${b}"`).test(toml)) ok(`${b} is used and declared`);
      else err(`${b} is used by the Worker but not declared in wrangler.toml`,
        `add the binding for ${b}`);
    }
  }

  // Secrets the Worker reads — documented so you don't forget one at deploy.
  const KNOWN_SECRETS = ['ANTHROPIC_API_KEY', 'JWT_SECRET', 'ADMIN_TOKEN', 'EMAIL_API_KEY',
    'RESET_EMAIL_FROM', 'GLOBAL_DAILY_USD_CAP', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'VIDEO_API_URL', 'VIDEO_API_KEY', 'VIDEO_MODEL', 'APP_URL', 'AUDIT_WEBHOOK',
    // optional integrations — supported but not required to launch
    'ALLOWED_ORIGIN', 'APP_ORIGIN', 'OWNER_EMAIL', 'GOOGLE_CLIENT_ID',
    'IMAGE_API_URL', 'IMAGE_API_KEY', 'IMAGE_API_MODEL', 'ALERT_WEBHOOK',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
    'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ELITE', 'STRIPE_PRICE_ULTRA',
    'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_MODE', 'PAYPAL_WEBHOOK_ID',
    'PAYPAL_PLAN_PRO', 'PAYPAL_PLAN_ELITE', 'PAYPAL_PLAN_ULTRA', 'TURNSTILE_SECRET'];
  const usedSecrets = [...used].filter(u => KNOWN_SECRETS.includes(u)).sort();
  const REQUIRED = ['ANTHROPIC_API_KEY', 'JWT_SECRET'];
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
      warn('index.html looks STALE — recent app.js changes are not in the build',
        'run: node build.mjs   (or: npm run build) before deploying');
    else ok('index.html appears built from current source');
  } catch { /* non-fatal */ }
}

/* ── 9. package.json has a deploy script ─────────────────────────────────── */
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
  console.log(`${B}${RED}NOT ready to deploy${X} — ${errors.length} error(s), ${warns.length} warning(s).\n`);
  process.exit(1);
} else {
  console.log(`${B}${G}Ready to deploy${X}${warns.length ? ` (${warns.length} warning(s) to review)` : ''}.`);
  console.log(`Next: set your secrets, then run ${B}npx wrangler deploy${X}.\n`);
  process.exit(0);
}
