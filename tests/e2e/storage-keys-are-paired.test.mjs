/* A SETTING THAT WRITES SOMEWHERE NOBODY READS.

   Local storage in this app has two doors. `saveStr`/`loadStr` go through
   `_scopeKey`, which prefixes the key with the signed-in account so two people
   on one machine do not read each other's settings. Raw
   `localStorage.getItem`/`setItem` do not. A key written through one and read
   through the other is a value that vanishes: no error, no warning, the setting
   simply never took.

   The same shape, one step further out: a key written and never read is a
   toggle that does nothing, and a key read and never written is a feature that
   never turns on. This codebase has shipped both - a preference recorded for a
   reader that did not exist, and a scheduler posting to a route that was never
   built. They look identical to working code from either side.

   WHAT THIS FILE CANNOT SEE, so that nobody reads more into a pass than is
   there: pairing is necessary and not sufficient. amv_pm_display had a writer
   and a reader and both of them sat in functions nothing called, so the key was
   completely dead while this check reported it healthy - _savePM was never
   invoked, so the payment-method row _loadPM fed could never render. A pair
   only means something when something can reach it. Reachability is
   every-entry-point-has-a-door's job; the two are halves of one question and
   neither answers it alone.

   None of it is visible by reading, because the two halves are in different
   files and each is correct where it sits. So it is computed: every key, every
   access, both directions, and an exhaustive list of the ones that are
   deliberately one-sided WITH the reason. There is no third state where nobody
   thought about it. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'src', 'app');
const files = readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
const src = Object.fromEntries(files.map(f => [f, readFileSync(join(DIR, f), 'utf8')]));
const all = files.map(f => src[f]).join('\n');

/* Constants that hold a storage key, so an access through the name counts. */
const named = {};
for(const m of all.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'(amv_[a-z0-9_]+)'/g)) named[m[1]] = m[2];

const scopedW = new Set(), scopedR = new Set(), rawW = new Set(), rawR = new Set(), erased = new Set();
/* A literal ending in _ is a PREFIX being concatenated with an id
   (amv_pfp_ + email), not a key. Counting it as one produced a false mixed-door
   report on the first run. */
const add = (set, k) => { if(k && /^amv_[a-z0-9_]+$/.test(k) && !k.endsWith('_')) set.add(k); };

for(const s of Object.values(src)){
  for(const m of s.matchAll(/\b(?:saveStr|store)\(\s*'([^']+)'/g))            add(scopedW, m[1]);
  for(const m of s.matchAll(/\b(?:loadStr|load)\(\s*'([^']+)'/g))             add(scopedR, m[1]);
  for(const m of s.matchAll(/\b(?:saveStr|store)\(\s*([A-Z_][A-Z0-9_]*)\s*[,)]/g))  add(scopedW, named[m[1]]);
  for(const m of s.matchAll(/\b(?:loadStr|load)\(\s*([A-Z_][A-Z0-9_]*)\s*[,)]/g))   add(scopedR, named[m[1]]);
  for(const m of s.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g))          add(rawW, m[1]);
  for(const m of s.matchAll(/localStorage\.getItem\(\s*'([^']+)'/g))    add(rawR, m[1]);
  /* Deleting a key is neither reading its value nor writing one - a key this
     build only ERASES is its own case, and pretending otherwise is how the
     admin-token cleanup first showed up here as a phantom read. */
  for(const m of s.matchAll(/localStorage\.removeItem\(\s*'([^']+)'/g)) add(erased, m[1]);
}

/* Keys the state proxy persists on its own behalf: assigning S.model writes
   amv_model without any saveStr appearing at the assignment. */
const persistBlock = all.slice(all.indexOf('const _PERSIST'), all.indexOf('};', all.indexOf('const _PERSIST')));
for(const m of persistBlock.matchAll(/'(amv_[a-z0-9_]+)'/g)) scopedW.add(m[1]);

/* Keys _loadPublicConfig fills from the backend. It writes through a computed
   key - saveStr(_PUBLIC_CONFIG_MAP[k], val) - so no literal appears at the call
   site, exactly like _PERSIST above. Reading the table is the difference
   between "the app fills this on first load" and "somebody has to type it into
   a console", and getting that backwards is what left amv_gauth excused here as
   operator-set long after the app had started writing it. */
const pubBlock = all.slice(all.indexOf('const _PUBLIC_CONFIG_MAP'),
                           all.indexOf('};', all.indexOf('const _PUBLIC_CONFIG_MAP')));
for(const m of pubBlock.matchAll(/'(amv_[a-z0-9_]+)'/g)) scopedW.add(m[1]);

/* Keys _scopeKey leaves alone, so both doors reach the same place for them. */
const globalBlock = all.slice(all.indexOf('const _GLOBAL_KEYS'), all.indexOf(']);', all.indexOf('const _GLOBAL_KEYS')));
const GLOBAL = new Set([...globalBlock.matchAll(/'(amv_[a-z0-9_]+)'/g)].map(m => m[1]));

const writes = new Set([...scopedW, ...rawW]);
const reads  = new Set([...scopedR, ...rawR]);
const keys   = new Set([...writes, ...reads, ...erased]);

/* Keys this build only removes: left behind by an older one, and cleaned up
   rather than used. Named, so "we only delete this" stays a decision. */
const ERASE_ONLY = {
  amv_admin_token: 'an admin secret an older build wrote to disk; erased on load, never stored again',
};

section('The keys were found');
{
  ok(keys.size > 80, 'storage keys across the source', keys.size);
  ok(GLOBAL.size > 10, 'and the unscoped ones', GLOBAL.size);
}

section('No key is written through one door and read through the other');
{
  /* The failure that loses data silently. A key written with saveStr lands
     under "u:email|key"; localStorage.getItem asks for "key" and finds nothing.
     Only keys in _GLOBAL_KEYS may use both, because for those _scopeKey is a
     no-op and the two doors lead to the same shelf. */
  /* Deliberately both, with the reason. */
  const BOTH_ON_PURPOSE = {
    amv_admin_token: 'erased on load, and it has to reach whichever spelling an older build used',
  };
  const mixed = [...keys].filter(k => {
    if(GLOBAL.has(k) || (k in BOTH_ON_PURPOSE)) return false;
    const scoped = scopedW.has(k) || scopedR.has(k);
    const raw    = rawW.has(k)    || rawR.has(k);
    return scoped && raw;
  }).sort();
  ok(mixed.length === 0,
     'nothing is stored per-account and looked up globally, or the reverse', mixed);
}

section('Every key is both written and read, or is named here with the reason');
{
  /* Read but never written: set by the operator by hand, in the console or by
     a deploy script. These are configuration, not state, and an empty value is
     the honest "not configured" that the app already degrades to. */
  const OPERATOR_SET = {
    amv_analytics_endpoint: 'where to post product analytics, if the operator wants any',
    amv_feedback_endpoint:  'where in-app feedback is forwarded, if anywhere',
    amv_browser_service:    'an external headless-browser service for the universal agent',
    amv_fin_provider:       'which bank aggregator this deployment uses',
    /* amv_canvas and amv_canvas_url were excused here as "an external canvas
       host" and "its address" - operator-set, nothing to do with the app.
       Both were residue of a Canvas integration that called a school straight
       from the browser, which the page's own policy had always refused, so
       neither key was ever written by anything. amv_canvas_url is gone
       entirely. amv_canvas is now written by the connect flow, after the
       server has proved the token against the real Canvas, and cleared when
       the server says a school is not connected - so it is state like any
       other key and is checked like any other key. */
    /* amv_gauth was excused here as "the Google OAuth client id for this
       deployment" - operator-set, type it in yourself. That was the whole
       defect: every visitor who was not the operator got a "Continue with
       Google" button with no client id behind it. The Worker has always known
       the id; nothing told the browser. /v1/public-config does now, so the key
       is written by the app like any other and is checked like any other. */
    amv_github:             'a GitHub token pasted by the person connecting it',
    amv_slack:              'a Slack webhook, likewise',
    amv_currency:           'a currency override; the geo lookup fills it otherwise',
    /* amv_mute_chime was excused here as "set from the settings UI through a
       computed key". That was not true of anything: no screen wrote it, so
       _playDoneChime's mute check could never fire and the sound could not be
       turned off - while its own comment called it "respectful - muteable".
       The excuse was where the defect hid. There is a real switch now, in
       Settings -> Appearance -> Sound, so the entry is gone and the pairing
       check covers it like any other preference. */
    /* amv_voice_rate was excused as "set from the voice panel". There was no
       voice panel and no control of any kind, so read-aloud was locked at 1.0x
       for everybody - and speaking speed is the first thing somebody using
       read-aloud wants to change. Like the chime above it, the excuse was
       doing the hiding. Settings -> Appearance -> Sound sets it now. */
    amv_plugin_web:         'per-plugin off switch; absent means on, which is the default',
    amv_stripe_customer:    'cached by the checkout return path when the processor sends one',
    amv_mkt_verified:       'set by the marketplace seller verification flow',
    amv_imgs:               'legacy image list, read for migration from an older build',
    amv_mem:                'legacy memory list, same',
    /* Read once on boot and deleted, never written again. The Google access
       token used to live here - a working bearer token to somebody's mail,
       readable by any script on the page and outliving the tab. It is held in
       memory now and re-minted from the server's refresh token on demand, so
       the only remaining reader is the migration that takes an existing one
       off disk. Without that, the change would have protected new connections
       and left every existing one exactly as exposed. */
    amv_gtoken:             'legacy Google access token, read once on boot to move it off disk, then removed',
    amv_gtoken_exp:         'its expiry, read and removed by the same migration',
  };
  /* Written but never read: residue. Each one is dead weight rather than a
     bug, and saying so here is what keeps it from being mistaken for a
     working feature by the next person to read the file. */
  const WRITE_ONLY = {
    amv_onboarded:        'the first-run popup was removed; these writes were left so nothing could re-trigger it',
    amv_ent_token:        'the server does not put a token on an entitlement record, so this never fires',
    amv_fin_pending:      'a link-in-progress marker the finance panel no longer consults',
    amv_owner:            'set by ?owner=1; the admin surfaces gate on the admin token instead',
  };

  const unread = [...writes].filter(k => !reads.has(k) && !(k in WRITE_ONLY)).sort();
  ok(unread.length === 0,
     'no setting writes somewhere nothing will ever look', unread);

  const unwritten = [...reads].filter(k => !writes.has(k) && !(k in OPERATOR_SET)).sort();
  const orphanErase = [...erased].filter(k => !(k in ERASE_ONLY) && !writes.has(k) && !reads.has(k)).sort();
  ok(orphanErase.length === 0, 'and a key this build only deletes says why', orphanErase);
  ok(unwritten.length === 0,
     'and nothing is read from a place nothing ever fills', unwritten);

  /* The lists cannot rot in the other direction either: an excuse that has
     since become untrue is itself a finding. */
  const nowRead = Object.keys(WRITE_ONLY).filter(k => reads.has(k));
  ok(nowRead.length === 0, 'nothing excused as write-only has quietly gained a reader', nowRead);
  const nowWritten = Object.keys(OPERATOR_SET).filter(k => writes.has(k));
  ok(nowWritten.length === 0, 'and nothing excused as operator-set is now written by the app', nowWritten);

  /* The third way an excuse rots, and the one nothing was checking: the key
     is gone. amv_canvas_url sat here excused as "an external canvas host's
     address" long after the code that read it had been deleted - so the list
     was carrying a reason for something that no longer existed, which is how
     the next key with a similar name inherits an excuse nobody re-examined.
     An exemption has to name something real. */
  const vanished = [...Object.keys(OPERATOR_SET), ...Object.keys(WRITE_ONLY), ...Object.keys(ERASE_ONLY)]
    .filter(k => !keys.has(k) && !all.includes("'" + k + "'"))
    .sort();
  ok(vanished.length === 0,
     'and every excused key still appears somewhere in the app', vanished);
}

section('The two doors are still different doors');
{
  /* If _scopeKey stopped scoping, the check above would be measuring nothing. */
  const at = all.indexOf('function _scopeKey');
  ok(at > 0, 'the scoping function is present', at > 0);
  const body = all.slice(at, at + 400);
  ok(/_GLOBAL_KEYS\.has\(k\)/.test(body), 'it exempts the global keys', true);
  ok(/'u:'\s*\+\s*who/.test(body), 'and prefixes everything else with the account', true);
}

if (report('storage-keys-are-paired') > 0) process.exitCode = 1;
done();
