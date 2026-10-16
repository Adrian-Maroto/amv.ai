/* ══════════════════════════════════════════════════════════════
   ERROR REPORTING  -  so a bug your users hit actually reaches YOU.

   Before this, errors went into a localStorage ring buffer and died there.
   A paying user hit a crash, saw a toast, and left. You never found out.

   Now: the client reports structured errors here. They're grouped by a
   FINGERPRINT (message + location), so 500 users hitting one bug shows up as
   one row with count=500, not 500 rows.

   PRIVACY: we never accept message contents, prompts, or code. Only the error
   itself, where it happened, and coarse environment. Emails are stored hashed.
   ══════════════════════════════════════════════════════════════ */

const ERR_MAX_GROUPS   = 500;      // distinct bugs tracked
const ERR_MAX_SAMPLES  = 5;        // sample occurrences kept per bug
const ERR_MAX_BATCH    = 20;       // events accepted per request
const ERR_RETENTION_MS = 30 * 86400e3;
/* WHEN A BUG IS AN OUTAGE.

   Errors were collected and nothing ever said a word about them. A release
   that breaks checkout for every visitor filled this index silently, and the
   first anybody heard was a customer email - or nothing at all, because the
   people it breaks for cannot use the product enough to complain.

   The signal is DISTINCT PEOPLE in a short window, not raw count. One person
   in a retry loop can produce a thousand events and is not an outage; five
   different people hitting the same fingerprint inside a quarter of an hour
   almost always is. Counting occurrences instead would page on the loop and
   stay quiet on the outage - exactly backwards. */
const ERR_BURST_MS     = 15 * 60e3;   // the window that counts as "at once"
const ERR_BURST_PEOPLE = 5;           // this many different people is not a coincidence
const ERR_BURST_KEEP   = 40;          // bounded: a burst list is not a user list

async function _errHash(s){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* Group errors that are really the same bug. */
async function _fingerprint(e){
  // Normalise everything that varies between users but means the same bug.
  // Without this, "Timeout after 3000ms" and "Timeout after 9500ms" become two
  // separate rows and your dashboard fragments into noise.
  const msg = String(e.msg||'')
    .replace(/https?:\/\/\S+/g,'<url>')          // urls differ per user
    .replace(/0x[0-9a-f]+/gi,'<hex>')             // addresses
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<uuid>')
    .replace(/\d+(\.\d+)?/g,'<n>')              // ANY number - note: no \b, so it also catches '3000ms'
    .replace(/'[^']*'|"[^"]*"/g,'<s>')            // quoted values (varying names)
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,180);
  return _errHash(msg + '|' + String(e.where||'') + '|' + String(e.kind||''));
}

/* POST /errors - the client reports a batch. No auth required (errors can
   happen before/without login), but it is strictly bounded and sanitised. */
