/* ============================================================
   CONSENT RECORD  (/v1/consent)

   A record that only exists in the user's own browser proves nothing
   in a dispute - they can clear it, and you cannot produce it. This
   stores the accepted terms version, the timestamp, and the request
   metadata server-side, which is the artifact that actually answers
   "did this user agree to your terms, and when?".
   ============================================================ */
async function consentRecord(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'consent:' + user.email, 10, 100, 'consent updates');
  if(blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const version = String(body.termsVersion || '').slice(0, 32);
  if(!version) return json({ error:'termsVersion required' }, 400);

  const entryIp = (request.headers.get('CF-Connecting-IP') || '').slice(0, 45);
  const entryCountry = (request.cf && request.cf.country) || '';
  const entryUa = (request.headers.get('User-Agent') || '').slice(0, 180);
  const nowYear = new Date().getUTCFullYear();
  let ageRecorded = null;
  let entry = null;
  /* AMV-033: THE BIRTH YEAR IS RECORDED ONCE, AND ONCE MEANS ONCE.

     The check below is deliberately write-once - the comment says a limit
     anyone can raise by retyping it is not a limit - and it was a read
     followed by a write. Two requests arriving together both read a record with
     no birth year, both decide they may set it, and the later one wins. So the
     value that cannot be edited could be edited, by sending it twice.

     Under the record lock the second request reads what the first stored and
     declines, which is what the rule already said. */
  await _withKind(env, 'consent', user.email, (prev) => {
  /* Age, recorded HERE and not only in the browser. The client has always had
     an age gate and it lives in localStorage, so clearing one key - or calling
     the API directly with a key - walked straight through it. Under-13 handling
     is strict liability and a minor's purchase comes back as a chargeback, so
     the one place it has to hold is the side the money runs on.

     A birth YEAR only: enough to gate correctly and the least personal thing
     that does the job. Recorded once and not editable afterwards, because a
     limit anyone can raise by retyping it is not a limit. */
  if(body.birthYear != null && !prev.birthYear){
    const y = Math.floor(+body.birthYear) || 0;
    if(y >= 1900 && y <= nowYear){
      prev.birthYear = y;
      prev.ageSetAt = Date.now();
      ageRecorded = { by: user.email, adult: (nowYear - y) >= ADULT_AGE };
    }
  }
  entry = { version, at: Date.now(), ip: entryIp, country: entryCountry, ua: entryUa };
  prev.current = entry;
  prev.history = [entry, ...(prev.history || [])].slice(0, 20);   // every version ever accepted
  }, { history: [] });
  /* Audited outside the lock: it is a storage write of its own, and holding a
     record lock across one is how a lease runs out mid-work. */
  if (ageRecorded) audit(env, 'age_recorded', ageRecorded);
  if (!entry) return json({ error: 'Could not record that just now. Please try again.' }, 503);
  audit(env, 'consent_accepted', { by: user.email, version });
  return json({ ok: true, version, at: entry.at });
}

