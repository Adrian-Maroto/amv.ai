/* THE FILE GOOGLE PLAY READS TO TRUST AMV'S ANDROID APP.

   AMV's Play listing is the web app in a Trusted Web Activity: the same app,
   full screen, with no browser bar. Android shows it that way only when the
   site says, at /.well-known/assetlinks.json, that this package signed with
   this key is allowed to. Without the file the app still works, but with an
   address bar across the top - which is the difference between an app and a
   bookmark.

   The fingerprint belongs to the owner's signing key (Play Console > Setup >
   App signing), so it cannot be written here in advance. config.json holds
   it; until it does, nothing is published and nothing claims otherwise. */

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SHA256_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/* The file's content, or null when the config is not complete. A malformed
   fingerprint is refused rather than published: a wrong one is worse than
   none, because it looks configured and verifies nothing. */
export function assetLinks(cfg) {
  if (!cfg || !PACKAGE_RE.test(String(cfg.packageId || ''))) return null;
  const prints = (Array.isArray(cfg.sha256) ? cfg.sha256 : []).map(s => String(s).trim().toUpperCase());
  if (!prints.length) return null;
  const bad = prints.find(p => !SHA256_RE.test(p));
  if (bad) throw new Error('apps/android/config.json: "' + bad.slice(0, 40) + '" is not a SHA-256 fingerprint (32 pairs like AB:CD:...)');
  return JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: cfg.packageId, sha256_cert_fingerprints: prints },
  }], null, 2) + '\n';
}
