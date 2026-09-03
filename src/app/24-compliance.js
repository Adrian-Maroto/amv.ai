/* ============================================================
   COMPLIANCE - the two things that actually decide whether you get
   sued or lose money, built as evidence rather than as promises.

   1. CONSENT RECORD. Linking to terms is worthless in a dispute; the
      record that THIS user accepted THIS version at THIS time is what
      wins one. Every acceptance is versioned and timestamped, and a
      material change re-prompts rather than silently applying.

   2. AGE. Under-13 collection is strict liability under COPPA (fines
      are per child, per violation) and the equivalent rules in the EU
      and UK. Minors also cannot form binding contracts, which is
      exactly why a teenager's purchases come straight back as
      chargebacks. So age is asked once, stored, and it gates the
      features that create that exposure - autonomous spending above
      all. This protects the user AND the payment processing.

   Nothing here is legal advice, and none of it substitutes for real
   terms drafted by a lawyer. It is the plumbing those terms need.
   ============================================================ */
const AMVCompliance = {
  KEY:'amv_consent',
  TERMS_VERSION:'2026-07-26',      // bump on any material change to re-prompt
  MIN_AGE:13,                      // below this we cannot collect data at all
  ADULT_AGE:18,                    // below this, money features stay off

  _rec(){ try{ return load(this.KEY) || {}; }catch(e){ return {}; } },
  _save(v){ try{ store(this.KEY, v); }catch(e){} },

  /* --- Consent ------------------------------------------------------- */

  accepted(){
    const r = this._rec();
    return !!(r.termsVersion === this.TERMS_VERSION && r.acceptedAt);
  },
  /* Record acceptance. Server-side too when connected, because a record that
     only exists in the user's own browser proves nothing in a dispute. */
  accept(){
    const r = this._rec();
    r.termsVersion = this.TERMS_VERSION;
    r.acceptedAt = Date.now();
    r.acceptedUA = (navigator && navigator.userAgent || '').slice(0,180);
    this._save(r);
    try{
      const base = (apiBase()||'').replace(/\/$/,'');
      const tok = (window.AMV_API && AMV_API.token)||'';
      if(base && tok) fetch(base + '/v1/consent', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
        /* The birth year goes with it. The gate that matters is the server's -
           this one lives in localStorage and a cleared key walked through it. */
        body: JSON.stringify({ termsVersion:r.termsVersion, acceptedAt:r.acceptedAt,
                               birthYear: r.birthYear || undefined })
      }).catch(()=>{});
    }catch(e){}
    return r;
  },
  consentRecord(){ const r=this._rec(); return { version:r.termsVersion||null, at:r.acceptedAt||null, current:this.accepted() }; },

  /* --- Age ----------------------------------------------------------- */

  /* Age is stored as a birth YEAR only - enough to gate correctly, and the
     least personal data that does the job. */
  setBirthYear(year){
    const y = parseInt(year, 10);
    const now = new Date().getFullYear();
    if(!y || y < 1900 || y > now) throw new Error('Enter the year you were born.');
    const age = now - y;
    if(age < this.MIN_AGE){
      // Do NOT store data for a child. Record only the refusal.
      const r = this._rec(); r.blockedUnderAge = true; r.blockedAt = Date.now(); delete r.birthYear;
      this._save(r);
      const e = new Error('AMV is not available under ' + this.MIN_AGE + '. We are not able to create an account.');
      e.code = 'under_age'; throw e;
    }
    const r = this._rec(); r.birthYear = y; r.ageSetAt = Date.now(); delete r.blockedUnderAge;
    this._save(r);
    /* Sent now as well as at acceptance, because age is usually confirmed after
       the terms - and the server refuses money until it has this. */
    try{
      const base = (apiBase()||'').replace(/\/$/,'');
      const tok = (window.AMV_API && AMV_API.token)||'';
      if(base && tok && r.termsVersion) fetch(base + '/v1/consent', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
        body: JSON.stringify({ termsVersion:r.termsVersion, birthYear:y })
      }).catch(()=>{});
    }catch(e){}
    return { age, adult: age >= this.ADULT_AGE };
  },
  age(){ const r=this._rec(); return r.birthYear ? (new Date().getFullYear() - r.birthYear) : null; },
  isAdult(){ const a=this.age(); return a == null ? false : a >= this.ADULT_AGE; },
  isBlocked(){ return !!this._rec().blockedUnderAge; },
  ageKnown(){ return this.age() != null; },

  /* --- The gate every risky capability calls -------------------------- */
  /* Returns null when allowed, or the reason it is refused. Deny by default:
     an unknown age is treated as "not verified", never as "adult". */
  gate(capability){
    if(this.isBlocked()) return 'This account cannot be used.';
    if(!this.accepted()) return 'Please accept the terms first.';
    const MONEY = ['spend','purchase','payout','withdraw','marketplace_sell','bank'];
    if(MONEY.indexOf(capability) >= 0){
      if(!this.ageKnown()) return 'Confirm your age before using anything that involves money.';
      if(!this.isAdult()) return 'Money features are only available to users ' + this.ADULT_AGE + ' and over. Ask an adult to set this up on their own account.';
    }
    return null;
  },

  /* What the user is agreeing to, in plain words. Short on purpose: terms
     nobody reads protect nobody. */
  SUMMARY:[
    'AMV is an AI assistant. It can make mistakes - check anything important before relying on it.',
    'You are responsible for what you ask AMV to do, and for actions taken from your account, including by anyone else using your device.',
    'AMV acts on your instructions. It does not guarantee results, prices, availability, delivery, or that an action can be undone.',
    'Anything involving money stays inside limits you set, and is only available to adults.',
    'You can export or delete your data at any time.'
  ]
};
try{ window.AMVCompliance = AMVCompliance; }catch(e){}

/* Ask for the year of birth, right where it is needed.

   The server refuses anything involving money until it knows, and for every
   account created before that check existed the answer is simply absent. Sending
   those people to hunt for a settings pane would read as the purchase being
   broken. Returns true once the answer is recorded. */
async function _askBirthYear(){
  try{
    if(AMVCompliance.ageKnown()) return true;
    if(typeof _showModalAsync !== 'function') return false;
    const v = await _showModalAsync({
      title:'What year were you born?',
      body:'Anything involving money is for over-18s only, so AMV has to ask once. Only the year is stored.',
      okText:'Confirm', cancelText:'Not now', placeholder:'e.g. 1994'
    });
    if(!v) return false;
    try{
      AMVCompliance.setBirthYear(v);
    }catch(e){
      if(typeof toast==='function') toast((e&&e.message)||'That did not look like a year.','error',6000);
      return false;
    }
    if(!AMVCompliance.isAdult()){
      if(typeof toast==='function')
        toast('Anything involving money is only available to people 18 and over.','info',7000);
      return false;
    }
    /* setBirthYear posts it to the server; give that a moment to land before the
       call that is about to depend on it is retried. */
    await new Promise(r=>setTimeout(r,400));
    return true;
  }catch(e){ return false; }
}
try{ window._askBirthYear = _askBirthYear; }catch(e){}

/* Wire the age gate into spending so it cannot be bypassed by calling the
   spend layer directly. This is the chargeback protection as much as the
   legal one: a minor's purchase is reversible by their parent's bank. */
try{
  if(typeof AMVSpend !== 'undefined' && !AMVSpend._ageWrapped){
    const _origCheck = AMVSpend.check.bind(AMVSpend);
    AMVSpend.check = function(amount, opts){
      try{
        const why = AMVCompliance.gate('spend');
        if(why) return { allow:false, reason:why };
      }catch(e){}
      return _origCheck(amount, opts);
    };
    AMVSpend._ageWrapped = true;
  }
}catch(e){}

try{
  if(typeof AMVConnectors !== 'undefined'){
    AMVConnectors.register({
      id:'compliance', name:'Terms & age', auth:'none', channel:'local',
      isLive(){ return true; },
      actions:{
        status:{ desc:'Whether terms are accepted, which version, and whether age is confirmed.',
          async run(){ return { consent:AMVCompliance.consentRecord(), ageKnown:AMVCompliance.ageKnown(),
            adult:AMVCompliance.isAdult(), summary:AMVCompliance.SUMMARY }; } },
        can_i:{ desc:'Check whether a capability is permitted for this account. Args: {capability}',
          async run(a){ const why=AMVCompliance.gate((a&&a.capability)||'');
            return { allowed:!why, reason:why||'Allowed.' }; } }
      }
    });
  }
}catch(e){}
