     always shut.

     `mailcfg:` and `school:` are still ORed in, because those stores are still
     written - somebody whose mailbox is connected with an app password has a
     real connection, and it is not this function's business to decide theirs
     has stopped counting. `goauth:` is NOT, and that distinction is the whole
     lesson: a fallback to a store nothing writes can never fire, so keeping it
     does not make the function more forgiving, it makes it look like it has a
     safety net it does not have. (The dead branch also read `g.refresh_token`
     while the only other reader of that record writes `g.refreshToken` - two
     spellings of a field nobody could have been reading.) The gate stage 'No
     decision is read out of a store nothing writes' now refuses to let it
     back. */
  const byProvider = new Set();
  const scopes = new Set();
  for(const k of Object.keys(conns || {})){
    const c = conns[k];
    if(!c) continue;
    if(c.provider) byProvider.add(String(c.provider));
    if(Array.isArray(c.scopes)) c.scopes.forEach(s => scopes.add(String(s)));
  }

  return {
    google: byProvider.has('google'),
    mail:   scopes.has('mail.read')  || !!(mail && mail.secret),
    school: scopes.has('school.read') || !!(school && school.token),
    /* Asked of the record that actually holds the aggregator token, which is
       the same record `_bankUse` opens. One store, one answer - the gate and
       the runner cannot disagree about whether a bank is linked. */
    bank:   !!(fin && fin.accessToken),
    /* The exact grants, carried so a later, finer check can ask "does this
       connection cover Drive" rather than only "is Google connected" - the
       coarse answer is right for the remedy it prints ("connect your Google
       account") and is not right for ever. */
    scopes: [...scopes],
  };
}

/* What THIS run is missing.

   `extra` is how a run says what it worked out for itself: today's Canvas
   assignment turning out to be an essay adds 'google', even though the job's
   standing instruction never mentioned Drive. That is the whole reason this is
   computed per run rather than once when the job was created. */
function _autoNeedsFor(item, connected, extra) {
  const text = String((item && item.detail) || '');
  const asked = new Set((Array.isArray(extra) ? extra : []).map(String));
  /* What the job DECLARED it opens, folded in through the one table. `boosts`
     is deliberately not read: a source that only improves the answer is not a
     reason to tell somebody their job cannot run. */
  for(const u of (Array.isArray(item && item.uses) ? item.uses : [])){
    const cap = AUTO_USE_TO_CAPABILITY[String(u)];
    if(cap) asked.add(cap);
  }
  const missing = [];
  for (const cap of AUTO_CAPABILITIES) {
    if (!(asked.has(cap.id) || cap.match.test(text))) continue;
    if (cap.has(connected || {}, item)) continue;
    missing.push({ id: cap.id, label: cap.label, needs: cap.needs, where: cap.where,
                   browserOnly: !!cap.browserOnly,
                   why: asked.has(cap.id) ? 'discovered' : 'instruction' });
  }
  return { ready: missing.length === 0, missing };
}

/* The sentence somebody reads against the run that stopped.

   Dated on purpose. A job that runs every night and only tonight needs
   something new is unactionable as "I need access" - the person has to know it
   is TODAY'S run, and which one. */
function _autoNeedsMessage(item, missing, atMs) {
  const when = new Date(atMs || Date.now()).toISOString().slice(0, 10);
  const what = String((item && item.detail) || 'this job').slice(0, 140);
  const lines = missing.map((m) => '  • ' + m.needs + '\n    (so AMV can ' + m.label + ' — add it in ' + m.where + ')');
  return 'Important: AMV needs your permission before it can finish this.\n\n'
       + 'Job: ' + what + '\nRun: ' + when + '\n\n'
       + 'What it needs:\n' + lines.join('\n')
       + '\n\nNothing was run and nothing was charged. Add ' + (missing.length > 1 ? 'these' : 'this')
       + ' and it picks up on the next run.';
}

/* ═══════════════════════════════════════════════════════════════════════
   JOB BOARDS OUTSIDE AMERICA, AND AN APPLY THAT ACTUALLY SENDS.

   Two problems, and the second is the one nobody had noticed.

   First: the job hunt knew about American boards. Somebody in Munich, Seoul,
   Warsaw or Mumbai does not use them, so the feature was decoration for most
   of the world.

   Second, and worse: the honest-capability note in the job hunt says an
   email-apply job is one AMV "can submit end to end", and names `gmail_send`
   as the thing that does it. There is no such route. There never was. The
   client decided `applied_email`, recorded that it had applied, and nothing
   left the building - which is precisely the class of thing AMV is not
   allowed to do.

   Both are fixed by the same piece of work. The mail connector gives AMV a way
   to send as the person, from their own mailbox, in twenty-two countries - so
   an email application is now genuinely sent, and it is sent from the address
   an employer can reply to rather than from AMV.

   WHERE AUTO-APPLY STOPS. Most large boards forbid automated applying in their
   terms: LinkedIn, Indeed, Seek and Naukri all do. AMV does not do it anyway
   and then hope. Where a board is an email application - which is still most
   of Europe's small and mid-size employers, and every public-sector posting
   that lists an address - AMV submits it. Everywhere else it prepares the
   whole application and hands it over for one tap, and the board entry says
   which of the two it is, so nobody has to guess.
   ═══════════════════════════════════════════════════════════════════════ */

/* `apply` is the honest field: what AMV can actually do on this board.
     email     an address is published, so AMV composes and sends it.
     portal    a web form with no apply API. AMV fills everything and you tap.
     account   applications only exist inside the board's own account system. */
const JOB_BOARDS = {
  /* ── THE TWENTY COUNTRIES AMV IS PROMOTED IN REACH FIVE BOARDS EACH ──────
     One board per country is a gesture. Somebody looking for work opens
     several, because the same job is not on all of them and the good local
     board is rarely the one an outsider would name. Five is the point at
     which the list is worth opening instead of going straight to Google.
     Where a board's own terms forbid automated applying, that is stated on
     the board rather than discovered by the person it happens to. */

  /* North America */
  computrabajomx:{ name: 'Computrabajo México', country: 'MX', flag: '🇲🇽', url: 'https://mx.computrabajo.com', apply: 'portal' },
  bumeranmx:   { name: 'Bumeran México', country: 'MX', flag: '🇲🇽', url: 'https://www.bumeran.com.mx', apply: 'portal' },
  empleogobmx: { name: 'Servicio Nacional de Empleo', country: 'MX', flag: '🇲🇽', url: 'https://www.empleo.gob.mx', apply: 'portal',
                 note: 'The government service; postings are placed by employers through state offices.' },
  talenteca:   { name: 'Talenteca', country: 'MX', flag: '🇲🇽', url: 'https://www.talenteca.com', apply: 'portal' },
  eluta:       { name: 'Eluta', country: 'CA', flag: '🇨🇦', url: 'https://www.eluta.ca', apply: 'portal',
                 note: 'Indexes employer career pages directly, so postings often appear here before the aggregators.' },
  talentcom:   { name: 'Talent.com Canada', country: 'CA', flag: '🇨🇦', url: 'https://ca.talent.com', apply: 'portal' },

  /* South America */
  infojobsbr:  { name: 'InfoJobs Brasil', country: 'BR', flag: '🇧🇷', url: 'https://www.infojobs.com.br', apply: 'portal' },
  gupy:        { name: 'Gupy', country: 'BR', flag: '🇧🇷', url: 'https://portal.gupy.io', apply: 'portal',
                 note: 'The applicant system most large Brazilian employers hire through.' },
  trabalhabrasil:{ name: 'Trabalha Brasil', country: 'BR', flag: '🇧🇷', url: 'https://www.trabalhabrasil.com.br', apply: 'portal' },
  clarinempleos:{ name: 'Empleos Clarín', country: 'AR', flag: '🇦🇷', url: 'https://empleos.clarin.com', apply: 'portal' },
  portalempleoar:{ name: 'Portal Empleo (Argentina)', country: 'AR', flag: '🇦🇷', url: 'https://www.argentina.gob.ar/trabajo/portalempleo', apply: 'portal',
                 note: 'The national employment portal.' },

  /* Europe */
  jobware:     { name: 'Jobware', country: 'DE', flag: '🇩🇪', url: 'https://www.jobware.de', apply: 'portal' },
  stellenanzeigen:{ name: 'stellenanzeigen.de', country: 'DE', flag: '🇩🇪', url: 'https://www.stellenanzeigen.de', apply: 'portal' },
  findajob:    { name: 'Find a job (GOV.UK)', country: 'GB', flag: '🇬🇧', url: 'https://findajob.dwp.gov.uk', apply: 'email',
                 note: 'The government service; many postings publish an application address directly.' },
  adzunauk:    { name: 'Adzuna UK', country: 'GB', flag: '🇬🇧', url: 'https://www.adzuna.co.uk', apply: 'portal' },
  hellowork:   { name: 'HelloWork', country: 'FR', flag: '🇫🇷', url: 'https://www.hellowork.com', apply: 'portal' },
  cadremploi:  { name: 'Cadremploi', country: 'FR', flag: '🇫🇷', url: 'https://www.cadremploi.fr', apply: 'portal' },
  subitolavoro:{ name: 'Subito Lavoro', country: 'IT', flag: '🇮🇹', url: 'https://www.subito.it/annunci-italia/vendita/offerte-lavoro', apply: 'portal' },
  cliclavoro:  { name: 'Cliclavoro', country: 'IT', flag: '🇮🇹', url: 'https://www.cliclavoro.gov.it', apply: 'portal',
                 note: 'The national labour ministry portal.' },
  jobrapidoit: { name: 'Jobrapido Italia', country: 'IT', flag: '🇮🇹', url: 'https://it.jobrapido.com', apply: 'portal' },
  monsterit:   { name: 'Monster Italia', country: 'IT', flag: '🇮🇹', url: 'https://www.monster.it', apply: 'portal' },
  superjob:    { name: 'SuperJob', country: 'RU', flag: '🇷🇺', url: 'https://www.superjob.ru', apply: 'portal' },
  rabotaru:    { name: 'Rabota.ru', country: 'RU', flag: '🇷🇺', url: 'https://www.rabota.ru', apply: 'portal' },
  avitorabota: { name: 'Avito Работа', country: 'RU', flag: '🇷🇺', url: 'https://www.avito.ru/rossiya/vakansii', apply: 'portal' },
  trudvsem:    { name: 'Работа России (Trudvsem)', country: 'RU', flag: '🇷🇺', url: 'https://trudvsem.ru', apply: 'portal',
                 note: 'The state employment service.' },

  /* Asia */
  lagou:       { name: 'Lagou (拉勾)', country: 'CN', flag: '🇨🇳', url: 'https://www.lagou.com', apply: 'portal',
                 note: 'Weighted to technology roles.' },
  apna:        { name: 'Apna', country: 'IN', flag: '🇮🇳', url: 'https://apna.co', apply: 'portal',
                 note: 'The largest reach for non-desk and entry-level work in India.' },
  ncsindia:    { name: 'National Career Service', country: 'IN', flag: '🇮🇳', url: 'https://www.ncs.gov.in', apply: 'portal',
                 note: 'The government portal.' },
  hellowork_jp:{ name: 'Hello Work (ハローワーク)', country: 'JP', flag: '🇯🇵', url: 'https://www.hellowork.mhlw.go.jp', apply: 'portal',
                 note: 'The public employment service; by far the widest coverage in Japan.' },
  wantedly:    { name: 'Wantedly', country: 'JP', flag: '🇯🇵', url: 'https://www.wantedly.com', apply: 'account' },
  work24:      { name: 'WorkNet (워크넷)', country: 'KR', flag: '🇰🇷', url: 'https://www.work24.go.kr', apply: 'portal',
                 note: 'The government employment service.' },
  incruit:     { name: 'Incruit (인크루트)', country: 'KR', flag: '🇰🇷', url: 'https://www.incruit.com', apply: 'portal' },
  kalibrrid:   { name: 'Kalibrr Indonesia', country: 'ID', flag: '🇮🇩', url: 'https://www.kalibrr.id', apply: 'portal' },
  siapkerja:   { name: 'SIAPkerja (Kemnaker)', country: 'ID', flag: '🇮🇩', url: 'https://kemnaker.go.id', apply: 'portal',
                 note: 'The labour ministry platform.' },
  jadarat:     { name: 'Jadarat (جدارات)', country: 'SA', flag: '🇸🇦', url: 'https://www.jadarat.sa', apply: 'portal',
                 note: 'The national employment platform.' },
  gulftalentsa:{ name: 'GulfTalent Saudi Arabia', country: 'SA', flag: '🇸🇦', url: 'https://www.gulftalent.com', apply: 'portal' },
  naukrigulf:  { name: 'Naukrigulf', country: 'SA', flag: '🇸🇦', url: 'https://www.naukrigulf.com', apply: 'portal' },

  /* Africa */
  hotnigerianjobs:{ name: 'Hot Nigerian Jobs', country: 'NG', flag: '🇳🇬', url: 'https://www.hotnigerianjobs.com', apply: 'email',
                 note: 'Most listings publish an application address.' },
  ngcareers:   { name: 'Ngcareers', country: 'NG', flag: '🇳🇬', url: 'https://ngcareers.com', apply: 'portal' },
  jobgurus:    { name: 'JobGurus', country: 'NG', flag: '🇳🇬', url: 'https://www.jobgurus.com.ng', apply: 'email' },
  careerjunction:{ name: 'CareerJunction', country: 'ZA', flag: '🇿🇦', url: 'https://www.careerjunction.co.za', apply: 'portal' },
  jobmail:     { name: 'Job Mail', country: 'ZA', flag: '🇿🇦', url: 'https://www.jobmail.co.za', apply: 'portal' },
  sayouth:     { name: 'SA Youth', country: 'ZA', flag: '🇿🇦', url: 'https://sayouth.mobi', apply: 'portal',
                 note: 'Zero-rated on South African networks, so it loads without data.' },
  baytegypt:   { name: 'Bayt Egypt', country: 'EG', flag: '🇪🇬', url: 'https://www.bayt.com/en/egypt', apply: 'portal' },
  jobzella:    { name: 'Jobzella', country: 'EG', flag: '🇪🇬', url: 'https://www.jobzella.com', apply: 'portal' },
  tanqeebeg:   { name: 'Tanqeeb Egypt', country: 'EG', flag: '🇪🇬', url: 'https://egypt.tanqeeb.com', apply: 'email' },

  /* Oceania */
  jora:        { name: 'Jora', country: 'AU', flag: '🇦🇺', url: 'https://au.jora.com', apply: 'portal' },
  careerone:   { name: 'CareerOne', country: 'AU', flag: '🇦🇺', url: 'https://www.careerone.com.au', apply: 'portal' },
  workforceau: { name: 'Workforce Australia', country: 'AU', flag: '🇦🇺', url: 'https://www.workforceaustralia.gov.au', apply: 'portal',
                 note: 'The government service.' },
  apsjobs:     { name: 'APS Jobs', country: 'AU', flag: '🇦🇺', url: 'https://www.apsjobs.gov.au', apply: 'portal',
                 note: 'Australian Public Service roles.' },

  /* ── AND TEN THAT WORK FROM ANYWHERE ─────────────────────────────────────
     Marked `global`, exactly like the worldwide mail providers, because a
     national board is useless to somebody in a country AMV has not reached
     yet and these are not. Aggregators that operate in dozens of countries,
     the remote boards where location is not a filter at all, and the
     freelance platforms - which for a great many people are not a career
     move but this month's income. */
  jooble:      { name: 'Jooble', country: '', flag: '🌐', global: true, url: 'https://jooble.org', apply: 'portal',
                 note: 'Aggregates local boards across roughly seventy countries.' },
  careerjet:   { name: 'Careerjet', country: '', flag: '🌐', global: true, url: 'https://www.careerjet.com', apply: 'portal',
                 note: 'Indexes in around ninety countries and as many languages.' },
  talentglobal:{ name: 'Talent.com', country: '', flag: '🌐', global: true, url: 'https://www.talent.com', apply: 'portal' },
  adzuna:      { name: 'Adzuna', country: '', flag: '🌐', global: true, url: 'https://www.adzuna.com', apply: 'portal' },
  jobrapido:   { name: 'Jobrapido', country: '', flag: '🌐', global: true, url: 'https://www.jobrapido.com', apply: 'portal' },
  remoteok:    { name: 'Remote OK', country: '', flag: '🌐', global: true, url: 'https://remoteok.com', apply: 'portal',
                 note: 'Remote roles, so the country somebody lives in is not a filter.' },
  weworkremotely:{ name: 'We Work Remotely', country: '', flag: '🌐', global: true, url: 'https://weworkremotely.com', apply: 'portal' },
  remotive:    { name: 'Remotive', country: '', flag: '🌐', global: true, url: 'https://remotive.com', apply: 'portal' },
  wellfound:   { name: 'Wellfound', country: '', flag: '🌐', global: true, url: 'https://wellfound.com', apply: 'account',
                 note: 'Startup roles; applying requires an account, so AMV prepares rather than sends.' },
  upwork:      { name: 'Upwork', country: '', flag: '🌐', global: true, url: 'https://www.upwork.com', apply: 'account',
                 note: 'Freelance work, which for many people is income this month rather than a career move. Proposals go through the platform, so AMV drafts and you send.' },

  /* ── Europe ──────────────────────────────────────────────────────────── */
  stepstone:   { name: 'StepStone', country: 'DE', flag: '🇩🇪', url: 'https://www.stepstone.de', apply: 'portal' },
  xing:        { name: 'XING Jobs', country: 'DE', flag: '🇩🇪', url: 'https://www.xing.com/jobs', apply: 'account' },
  arbeitsagentur:{ name: 'Bundesagentur für Arbeit', country: 'DE', flag: '🇩🇪', url: 'https://www.arbeitsagentur.de/jobsuche', apply: 'email',
                 note: 'Public-sector and Mittelstand postings here usually list an application address.' },
  karriereat:  { name: 'karriere.at', country: 'AT', flag: '🇦🇹', url: 'https://www.karriere.at', apply: 'portal' },
  jobsch:      { name: 'jobs.ch', country: 'CH', flag: '🇨🇭', url: 'https://www.jobs.ch', apply: 'portal' },
  reed:        { name: 'Reed', country: 'GB', flag: '🇬🇧', url: 'https://www.reed.co.uk', apply: 'portal' },
  totaljobs:   { name: 'Totaljobs', country: 'GB', flag: '🇬🇧', url: 'https://www.totaljobs.com', apply: 'portal' },
  cvlibrary:   { name: 'CV-Library', country: 'GB', flag: '🇬🇧', url: 'https://www.cv-library.co.uk', apply: 'portal' },
  irishjobs:   { name: 'IrishJobs', country: 'IE', flag: '🇮🇪', url: 'https://www.irishjobs.ie', apply: 'portal' },
  wttj:        { name: 'Welcome to the Jungle', country: 'FR', flag: '🇫🇷', url: 'https://www.welcometothejungle.com', apply: 'portal' },
  apec:        { name: 'APEC', country: 'FR', flag: '🇫🇷', url: 'https://www.apec.fr', apply: 'email',
                 note: 'Cadre postings frequently publish a contact address.' },
  francetravail:{ name: 'France Travail (Pôle emploi)', country: 'FR', flag: '🇫🇷', url: 'https://candidat.francetravail.fr', apply: 'email' },
  infojobs:    { name: 'InfoJobs', country: 'ES', flag: '🇪🇸', url: 'https://www.infojobs.net', apply: 'portal' },
  infojobsit:  { name: 'InfoJobs Italia', country: 'IT', flag: '🇮🇹', url: 'https://www.infojobs.it', apply: 'portal' },
  nationalevb: { name: 'Nationale Vacaturebank', country: 'NL', flag: '🇳🇱', url: 'https://www.nationalevacaturebank.nl', apply: 'portal' },
  vdab:        { name: 'VDAB', country: 'BE', flag: '🇧🇪', url: 'https://www.vdab.be', apply: 'email' },
  pracuj:      { name: 'Pracuj.pl', country: 'PL', flag: '🇵🇱', url: 'https://www.pracuj.pl', apply: 'portal' },
  olxpraca:    { name: 'OLX Praca', country: 'PL', flag: '🇵🇱', url: 'https://www.olx.pl/praca', apply: 'email' },
  jobscz:      { name: 'Jobs.cz', country: 'CZ', flag: '🇨🇿', url: 'https://www.jobs.cz', apply: 'portal' },
  netempregos: { name: 'Net-Empregos', country: 'PT', flag: '🇵🇹', url: 'https://www.net-empregos.com', apply: 'email' },
  jobindex:    { name: 'Jobindex', country: 'DK', flag: '🇩🇰', url: 'https://www.jobindex.dk', apply: 'email' },
  finn:        { name: 'FINN Jobb', country: 'NO', flag: '🇳🇴', url: 'https://www.finn.no/job', apply: 'email' },
  arbetsformedlingen:{ name: 'Arbetsförmedlingen', country: 'SE', flag: '🇸🇪', url: 'https://arbetsformedlingen.se/platsbanken', apply: 'email' },
  duunitori:   { name: 'Duunitori', country: 'FI', flag: '🇫🇮', url: 'https://duunitori.fi', apply: 'email' },
  hh:          { name: 'HeadHunter (hh.ru)', country: 'RU', flag: '🇷🇺', url: 'https://hh.ru', apply: 'account' },
  workua:      { name: 'Work.ua', country: 'UA', flag: '🇺🇦', url: 'https://www.work.ua', apply: 'portal' },
  kariyer:     { name: 'Kariyer.net', country: 'TR', flag: '🇹🇷', url: 'https://www.kariyer.net', apply: 'portal' },

  /* ── Asia ────────────────────────────────────────────────────────────── */
  job51:       { name: '51job (前程无忧)', country: 'CN', flag: '🇨🇳', url: 'https://www.51job.com', apply: 'account' },
  zhaopin:     { name: 'Zhaopin (智联招聘)', country: 'CN', flag: '🇨🇳', url: 'https://www.zhaopin.com', apply: 'account' },
  bosszhipin:  { name: 'BOSS Zhipin (BOSS直聘)', country: 'CN', flag: '🇨🇳', url: 'https://www.zhipin.com', apply: 'account',
                 note: 'Applications are a chat with the hiring manager inside the app, so AMV prepares the message rather than sending it.' },
  liepin:      { name: 'Liepin (猎聘)', country: 'CN', flag: '🇨🇳', url: 'https://www.liepin.com', apply: 'account' },
  rikunabi:    { name: 'Rikunabi (リクナビ)', country: 'JP', flag: '🇯🇵', url: 'https://job.rikunabi.com', apply: 'account' },
  doda:        { name: 'doda', country: 'JP', flag: '🇯🇵', url: 'https://doda.jp', apply: 'account' },
  mynavi:      { name: 'Mynavi (マイナビ)', country: 'JP', flag: '🇯🇵', url: 'https://tenshoku.mynavi.jp', apply: 'account' },
  saramin:     { name: 'Saramin (사람인)', country: 'KR', flag: '🇰🇷', url: 'https://www.saramin.co.kr', apply: 'account' },
  jobkorea:    { name: 'JobKorea (잡코리아)', country: 'KR', flag: '🇰🇷', url: 'https://www.jobkorea.co.kr', apply: 'account' },
  wanted:      { name: 'Wanted', country: 'KR', flag: '🇰🇷', url: 'https://www.wanted.co.kr', apply: 'account' },
  naukri:      { name: 'Naukri', country: 'IN', flag: '🇮🇳', url: 'https://www.naukri.com', apply: 'portal' },
  foundit:     { name: 'foundit (Monster India)', country: 'IN', flag: '🇮🇳', url: 'https://www.foundit.in', apply: 'portal' },
  shine:       { name: 'Shine', country: 'IN', flag: '🇮🇳', url: 'https://www.shine.com', apply: 'portal' },
  mycareersfuture:{ name: 'MyCareersFuture', country: 'SG', flag: '🇸🇬', url: 'https://www.mycareersfuture.gov.sg', apply: 'portal' },
  jobstreet:   { name: 'JobStreet', country: 'MY', flag: '🇲🇾', url: 'https://www.jobstreet.com.my', apply: 'portal' },
  kalibrr:     { name: 'Kalibrr', country: 'PH', flag: '🇵🇭', url: 'https://www.kalibrr.com', apply: 'portal' },
  vietnamworks:{ name: 'VietnamWorks', country: 'VN', flag: '🇻🇳', url: 'https://www.vietnamworks.com', apply: 'portal' },
  topcv:       { name: 'TopCV', country: 'VN', flag: '🇻🇳', url: 'https://www.topcv.vn', apply: 'portal' },
  jobsdb:      { name: 'JobsDB', country: 'HK', flag: '🇭🇰', url: 'https://hk.jobsdb.com', apply: 'portal' },
  job104:      { name: '104 Job Bank (104人力銀行)', country: 'TW', flag: '🇹🇼', url: 'https://www.104.com.tw', apply: 'account' },
  jobsdbth:    { name: 'JobsDB Thailand', country: 'TH', flag: '🇹🇭', url: 'https://th.jobsdb.com', apply: 'portal' },
  bayt:        { name: 'Bayt', country: 'AE', flag: '🇦🇪', url: 'https://www.bayt.com', apply: 'portal' },
  gulftalent:  { name: 'GulfTalent', country: 'AE', flag: '🇦🇪', url: 'https://www.gulftalent.com', apply: 'portal' },
  alljobs:     { name: 'AllJobs', country: 'IL', flag: '🇮🇱', url: 'https://www.alljobs.co.il', apply: 'email' },

  /* ── North America ───────────────────────────────────────────────── */
  indeed:      { name: 'Indeed', country: 'US', flag: '🇺🇸', url: 'https://www.indeed.com', apply: 'portal',
                 note: 'Indeed forbids automated applying, so AMV fills the application and you send it.' },
  linkedin:    { name: 'LinkedIn Jobs', country: 'US', flag: '🇺🇸', url: 'https://www.linkedin.com/jobs', apply: 'account',
                 note: 'LinkedIn forbids automation outright. AMV prepares the application and nothing more.' },
  ziprecruiter:{ name: 'ZipRecruiter', country: 'US', flag: '🇺🇸', url: 'https://www.ziprecruiter.com', apply: 'portal' },
  glassdoor:   { name: 'Glassdoor', country: 'US', flag: '🇺🇸', url: 'https://www.glassdoor.com/Job', apply: 'portal' },
  usajobs:     { name: 'USAJOBS', country: 'US', flag: '🇺🇸', url: 'https://www.usajobs.gov', apply: 'portal',
                 note: 'Federal postings; applications go through the government portal.' },
  dice:        { name: 'Dice', country: 'US', flag: '🇺🇸', url: 'https://www.dice.com', apply: 'portal' },
  jobbank:     { name: 'Job Bank (Government of Canada)', country: 'CA', flag: '🇨🇦', url: 'https://www.jobbank.gc.ca', apply: 'email',
                 note: 'Most Job Bank postings publish an application address, so AMV can send these.' },
  workopolis:  { name: 'Workopolis', country: 'CA', flag: '🇨🇦', url: 'https://www.workopolis.com', apply: 'portal' },
  jobillico:   { name: 'Jobillico', country: 'CA', flag: '🇨🇦', url: 'https://www.jobillico.com', apply: 'portal' },

  /* ── South America ───────────────────────────────────────────────── */
  bumeran:     { name: 'Bumeran', country: 'AR', flag: '🇦🇷', url: 'https://www.bumeran.com.ar', apply: 'portal' },
  zonajobs:    { name: 'ZonaJobs', country: 'AR', flag: '🇦🇷', url: 'https://www.zonajobs.com.ar', apply: 'portal' },
  computrabajo:{ name: 'Computrabajo', country: 'AR', flag: '🇦🇷', url: 'https://ar.computrabajo.com', apply: 'portal' },

  /* ── Southeast Asia and the Middle East ──────────────────────────── */
  glints:      { name: 'Glints', country: 'ID', flag: '🇮🇩', url: 'https://glints.com/id', apply: 'portal' },
  jobstreetid: { name: 'JobStreet Indonesia', country: 'ID', flag: '🇮🇩', url: 'https://www.jobstreet.co.id', apply: 'portal' },
  karir:       { name: 'Karir.com', country: 'ID', flag: '🇮🇩', url: 'https://www.karir.com', apply: 'portal' },
  tanqeeb:     { name: 'Tanqeeb', country: 'SA', flag: '🇸🇦', url: 'https://saudi.tanqeeb.com', apply: 'email' },
  bayts:       { name: 'Bayt Saudi Arabia', country: 'SA', flag: '🇸🇦', url: 'https://www.bayt.com/en/saudi-arabia', apply: 'portal' },

  /* ── Africa ──────────────────────────────────────────────────────── */
  wuzzuf:      { name: 'Wuzzuf', country: 'EG', flag: '🇪🇬', url: 'https://wuzzuf.net', apply: 'portal' },
  forasna:     { name: 'Forasna (فرصنا)', country: 'EG', flag: '🇪🇬', url: 'https://forasna.com', apply: 'portal' },
  myjobmag:    { name: 'MyJobMag', country: 'NG', flag: '🇳🇬', url: 'https://www.myjobmag.com', apply: 'email',
                 note: 'Many Nigerian postings list an application address directly.' },
  careers24:   { name: 'Careers24', country: 'ZA', flag: '🇿🇦', url: 'https://www.careers24.com', apply: 'portal' },
  brightermonday:{ name: 'BrighterMonday', country: 'KE', flag: '🇰🇪', url: 'https://www.brightermonday.co.ke', apply: 'portal' },

  /* ── elsewhere, so the picture is not Europe and Asia only ───────────── */
  seek:        { name: 'Seek', country: 'AU', flag: '🇦🇺', url: 'https://www.seek.com.au', apply: 'portal' },
  catho:       { name: 'Catho', country: 'BR', flag: '🇧🇷', url: 'https://www.catho.com.br', apply: 'portal' },
  vagas:       { name: 'Vagas.com', country: 'BR', flag: '🇧🇷', url: 'https://www.vagas.com.br', apply: 'portal' },
  occ:         { name: 'OCC Mundial', country: 'MX', flag: '🇲🇽', url: 'https://www.occ.com.mx', apply: 'portal' },
  jobberman:   { name: 'Jobberman', country: 'NG', flag: '🇳🇬', url: 'https://www.jobberman.com', apply: 'portal' },
  pnet:        { name: 'Pnet', country: 'ZA', flag: '🇿🇦', url: 'https://www.pnet.co.za', apply: 'portal' },
};

/* How many applications AMV will send as somebody in one day.

   An auto-apply feature that can send unbounded mail from a person's own
   address is a spam cannon wearing a job hunt's clothes, and the account it
   would get suspended is theirs, not AMV's. Twenty-five is more than any real
   person sends in a day and far below anything a provider treats as bulk. */
const JOB_APPLY_DAILY_CAP = 25;

/* What AMV can honestly do on this board. */
function _jobBoardChannel(id) {
  const b = JOB_BOARDS[id];
  return b ? b.apply : 'unknown';
}

/* The catalogue, so the interface can show somebody the boards their country
   actually uses instead of four American ones. */
async function jobBoards(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const boards = Object.entries(JOB_BOARDS).map(([id, b]) => ({
    id, name: b.name, country: b.country, flag: b.flag, url: b.url,
    apply: b.apply, note: b.note || '', global: !!b.global,
    /* Said once, here, rather than left for the interface to guess: only an
       email application is something AMV can complete on its own. */
    autoApply: b.apply === 'email',
  }));
  /* A worldwide board has no country, and counting the empty string as one
     would report one country more than AMV actually reaches. */
  const countries = new Set(boards.filter((b) => b.country).map((b) => b.country));
  return json({ ok: true, boards, countries: countries.size, dailyCap: JOB_APPLY_DAILY_CAP });
}

/* SEND THE APPLICATION. FOR REAL, THIS TIME.

   The job hunt has always described an email-apply posting as one AMV "can
   submit end to end", and named `gmail_send` as what does it. No such route
   existed. The client decided `applied_email`, wrote it into the history, and
   nothing was sent - a feature reporting success for work that never happened,
   which is the one thing this product is not allowed to do.

