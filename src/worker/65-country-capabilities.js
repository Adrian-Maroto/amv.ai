   It sends from the person's OWN mailbox rather than from AMV, for two reasons
   that both matter to whether they get the job: an employer replying goes to
   them, and a message from a stranger's automation is a message that lands in
   spam. That is only possible at all because the mail connector exists, and it
   works in every country it covers rather than only where Gmail is used. */
async function jobApply(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* Sending mail as somebody, to strangers, is outward-facing. An account on
     hold does not get to do it. */
  const held = await _accountHold(env, user, 'job_apply');
  if (held) return held;

  const body = await request.json().catch(() => ({}));
  const to = String(body.to || '').trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return json({ error: 'That posting has no application address AMV can send to. It can prepare the application for you to submit instead.',
                  code: 'no_apply_email' }, 400);
  }
  const subject = String(body.subject || '').trim().slice(0, 250);
  const text = String(body.text || '').slice(0, 60000);
  if (!subject || !text.trim()) return json({ error: 'The application is empty.', code: 'bad_body' }, 400);

  const job = (body.job && typeof body.job === 'object') ? body.job : {};
  const boardId = String(job.board || '');
  const board = JOB_BOARDS[boardId] || null;

  /* ONE A DAY IS A JOB HUNT. FIVE HUNDRED IS A SPAM RUN.

     Counted atomically, before anything is sent, against the person rather
     than the device - and the account that gets suspended for bulk sending
     would be theirs, not AMV's, which is why this is a hard stop and not a
     warning. */
  let res = null;
  try {
    res = await counter(env, `jobapply:${user.email}:${todayKey()}`,
                        { op: 'reserve', amount: 1, cap: JOB_APPLY_DAILY_CAP, ttlMs: 86400000 * 2 });
  } catch (e) {
    audit(env, 'job_apply_uncounted', { by: user.email, error: String((e && e.message) || e) });
    return json({ error: 'AMV could not check how many applications you have sent today, so it has not sent this one.',
                  code: 'not_ready' }, 503);
  }
  if (!res.allowed) {
    return json({ error: `That is ${JOB_APPLY_DAILY_CAP} applications sent today, which is the daily limit. It resets tomorrow - the rest are prepared and waiting.`,
                  code: 'apply_cap' }, 429);
  }
  const giveBack = async () => {
    try { await counter(env, `jobapply:${user.email}:${todayKey()}`, { op: 'incr', amount: -1, ttlMs: 86400000 * 2 }); } catch (e) {}
  };

  const cfg = await _mailCfgFor(env, user.email);
  if (!cfg) {
    await giveBack();
    return json({ error: 'AMV sends applications from your own mailbox, so an employer replies to you rather than to us. Connect your mailbox first.',
                  code: 'mail_not_connected' }, 428);
  }

  try {
    await _smtpSend(cfg, { to: [to], subject, text });
  } catch (e) {
    await giveBack();
    const kind = (e && e.kind) || (String(e && e.message) === 'mail_timeout' ? 'timeout' : 'net');
    audit(env, 'job_apply_failed', { by: user.email, board: boardId, kind });
    const fail = _mailFailure(kind, cfg.provider);
    /* Named as an application that did NOT go, because "could not send" on a
       screen listing applications reads as a delivery note. */
    return json({ error: 'This application was not sent. ' + fail.error, code: fail.code, sent: false },
                kind === 'auth' ? 401 : 502);
  }

  /* Recorded because an application sent on somebody's behalf, to a named
     employer, is exactly the kind of autonomous action that has to leave a
     trail - without the letter itself, which is theirs. */
  audit(env, 'job_applied', { by: user.email, board: boardId,
                              country: board ? board.country : '',
                              title: String(job.title || '').slice(0, 80) });
  return json({ ok: true, sent: true, to, board: boardId,
                remainingToday: Math.max(0, JOB_APPLY_DAILY_CAP - (res.value || 0)),
                from: cfg.address });
}

/* ═══════════════════════════════════════════════════════════════════════
   WHAT AMV CAN DO WHERE.

   The first question somebody outside the United States has is not "what
   features does this have", it is "does any of this work where I live". Until
   now the only way to answer that was to read an integrations list and infer.

   COMPUTED FROM THE REGISTRIES, never written by hand. A country appears here
   because a mail provider or a job board names it, and the counts are the
   actual length of those lists. A hand-maintained coverage page is a promise
   that goes stale in a month and then lies to exactly the people it was built
   to reach; this one cannot say more than the product does.

   Global providers - Gmail, Outlook, Yahoo, iCloud and the rest - count for
   every country, because they are what somebody in Lagos or Jakarta is most
   likely to actually be using. Counting only national ISPs would report Egypt
   as having no mail, which is false and would be the wrong thing to promote.
   ═══════════════════════════════════════════════════════════════════════ */

/* Only the countries the registries actually name. Adding a provider for a new
   country and forgetting this map leaves it grouped under "Other", which is
   visible rather than silent - the coverage test asserts it is empty. */
const CONTINENT_OF = {
  US: 'North America', CA: 'North America', MX: 'North America',
  BR: 'South America', AR: 'South America',
  GB: 'Europe', IE: 'Europe', FR: 'Europe', DE: 'Europe', AT: 'Europe', CH: 'Europe',
  ES: 'Europe', IT: 'Europe', PT: 'Europe', NL: 'Europe', BE: 'Europe', PL: 'Europe',
  CZ: 'Europe', DK: 'Europe', NO: 'Europe', SE: 'Europe', FI: 'Europe', RU: 'Europe',
  UA: 'Europe', TR: 'Europe',
  CN: 'Asia', JP: 'Asia', KR: 'Asia', IN: 'Asia', SG: 'Asia', MY: 'Asia', PH: 'Asia',
  VN: 'Asia', HK: 'Asia', TW: 'Asia', TH: 'Asia', ID: 'Asia', AE: 'Asia', SA: 'Asia', IL: 'Asia',
  ZA: 'Africa', NG: 'Africa', EG: 'Africa', KE: 'Africa',
  AU: 'Oceania', NZ: 'Oceania',
  /* Added with the everyday catalogue. A country belongs on a continent the
     moment AMV does anything for it, not the moment it gets a mail provider -
     otherwise the coverage board groups it under "Other", which the test
     refuses and which would be right to refuse. */
  PK: 'Asia', BD: 'Asia', LK: 'Asia', NP: 'Asia', KZ: 'Asia', UZ: 'Asia',
  KH: 'Asia', MM: 'Asia', IQ: 'Asia', JO: 'Asia', QA: 'Asia', KW: 'Asia',
  OM: 'Asia', BH: 'Asia', LB: 'Asia', AZ: 'Asia', GE: 'Asia', AM: 'Asia', MN: 'Asia',
  ET: 'Africa', TZ: 'Africa', UG: 'Africa', GH: 'Africa', MA: 'Africa',
  DZ: 'Africa', TN: 'Africa', SN: 'Africa', CI: 'Africa', CM: 'Africa',
  ZM: 'Africa', ZW: 'Africa', RW: 'Africa', MZ: 'Africa', AO: 'Africa',
  BW: 'Africa', NA: 'Africa',
  CO: 'South America', PE: 'South America', CL: 'South America',
  EC: 'South America', BO: 'South America', VE: 'South America',
  UY: 'South America', PY: 'South America',
  GT: 'North America', DO: 'North America', CR: 'North America', PA: 'North America',
  RO: 'Europe', GR: 'Europe', HU: 'Europe', BG: 'Europe', RS: 'Europe',
  HR: 'Europe', SK: 'Europe', SI: 'Europe', LT: 'Europe', LV: 'Europe', EE: 'Europe',
};

const COUNTRY_NAME = {
  US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina',
  GB: 'United Kingdom', IE: 'Ireland', FR: 'France', DE: 'Germany', AT: 'Austria',
  CH: 'Switzerland', ES: 'Spain', IT: 'Italy', PT: 'Portugal', NL: 'Netherlands',
  BE: 'Belgium', PL: 'Poland', CZ: 'Czechia', DK: 'Denmark', NO: 'Norway', SE: 'Sweden',
  FI: 'Finland', RU: 'Russia', UA: 'Ukraine', TR: 'Türkiye',
  CN: 'China', JP: 'Japan', KR: 'South Korea', IN: 'India', SG: 'Singapore',
  MY: 'Malaysia', PH: 'Philippines', VN: 'Vietnam', HK: 'Hong Kong', TW: 'Taiwan',
  TH: 'Thailand', ID: 'Indonesia', AE: 'United Arab Emirates', SA: 'Saudi Arabia', IL: 'Israel',
  ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt', KE: 'Kenya',
  AU: 'Australia', NZ: 'New Zealand',
  PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal',
  KZ: 'Kazakhstan', UZ: 'Uzbekistan', KH: 'Cambodia', MM: 'Myanmar',
  IQ: 'Iraq', JO: 'Jordan', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman',
  BH: 'Bahrain', LB: 'Lebanon', AZ: 'Azerbaijan', GE: 'Georgia',
  AM: 'Armenia', MN: 'Mongolia',
  ET: 'Ethiopia', TZ: 'Tanzania', UG: 'Uganda', GH: 'Ghana', MA: 'Morocco',
  DZ: 'Algeria', TN: 'Tunisia', SN: 'Senegal', CI: "Cote d'Ivoire",
  CM: 'Cameroon', ZM: 'Zambia', ZW: 'Zimbabwe', RW: 'Rwanda',
  MZ: 'Mozambique', AO: 'Angola', BW: 'Botswana', NA: 'Namibia',
  CO: 'Colombia', PE: 'Peru', CL: 'Chile', EC: 'Ecuador', BO: 'Bolivia',
  VE: 'Venezuela', UY: 'Uruguay', PY: 'Paraguay',
  GT: 'Guatemala', DO: 'Dominican Republic', CR: 'Costa Rica', PA: 'Panama',
  RO: 'Romania', GR: 'Greece', HU: 'Hungary', BG: 'Bulgaria', RS: 'Serbia',
  HR: 'Croatia', SK: 'Slovakia', SI: 'Slovenia', LT: 'Lithuania',
  LV: 'Latvia', EE: 'Estonia',
};

/* WHAT IS CALLED WHAT, IN EACH COUNTRY AMV WORKS IN.

   Asked for: every country's Crew is its own - the jobs that show are the ones
   that matter THERE, and they name things the way they are named there. The
   hundred-odd jobs everybody needs (the inbox, the bills, the tax papers, the
   job search, the renewals) are the same shape everywhere; what differs is who
   collects the tax, which bank the statement is from, which site the jobs are
   on. This is that difference, per country, and it is used twice: on the card
   ("InfoJobs, LinkedIn, Indeed") and in the run, where the job is told where
   the person is and what things are called there.

   LEFT OUT RATHER THAN GUESSED. A field is here only when it is well known. A
   job whose field is missing says "the national tax authority" rather than a
   name that might be wrong, because the name is the thing somebody acts on -
   the wrong agency is a wasted afternoon, the wrong deadline is a fine. The
   runner is also told to check any rule, deadline or amount against the
   official source for the country rather than trust this table for it.

   Keys: cur tax gov id banks pay jobs shop groc food rail prop car health news
   exams uni telco post weather. Values are plain text, lists comma-separated. */
const COUNTRY_FACTS = {
  US: { cur:'USD', tax:'the IRS', gov:'Login.gov', id:'the State Department (passports) and your state DMV', banks:'Chase, Bank of America, Wells Fargo, Citi', cards:'Chase, American Express, Capital One, Citi, Discover', pay:'Zelle, Venmo, Cash App', jobs:'LinkedIn, Indeed, ZipRecruiter', shop:'Amazon, Walmart, Target, Best Buy', groc:'Walmart, Kroger, Costco, Aldi', food:'DoorDash, Uber Eats, Grubhub', rail:'Amtrak', prop:'Zillow, Redfin, Realtor.com', car:'your state DMV (registration and inspection)', health:'your health insurer, and Medicare or Medicaid where they apply', news:'AP, Reuters, The New York Times', exams:'the SAT, ACT and AP exams', uni:'the Common App', telco:'Verizon, AT&T, T-Mobile', post:'USPS, UPS, FedEx', weather:'the National Weather Service' },
  CA: { cur:'CAD', tax:'the Canada Revenue Agency (CRA)', gov:'CRA My Account (GCKey or a Sign-In Partner)', id:'Passport Canada and your provincial licensing office', banks:'RBC, TD, Scotiabank, BMO, CIBC', pay:'Interac e-Transfer', jobs:'Indeed, LinkedIn, Job Bank', shop:'Amazon.ca, Walmart, Canadian Tire', groc:'Loblaws, Sobeys, Metro, Costco', food:'Uber Eats, DoorDash, SkipTheDishes', rail:'VIA Rail', prop:'Realtor.ca', car:'your provincial licensing office (ServiceOntario, SAAQ, ICBC and others)', health:'your provincial health plan (OHIP, RAMQ, MSP and others)', news:'CBC, The Globe and Mail', uni:'OUAC in Ontario, and your province’s application service', telco:'Rogers, Bell, Telus', post:'Canada Post', weather:'Environment Canada' },
  MX: { cur:'MXN', tax:'the SAT', gov:'your e.firma and the SAT portal', id:'the SRE (passports) and the INE credential', banks:'BBVA México, Banorte, Santander, Banamex', pay:'SPEI transfers, Mercado Pago', jobs:'OCC Mundial, Computrabajo, LinkedIn, Indeed', shop:'Mercado Libre, Amazon.com.mx, Liverpool', groc:'Walmart, Soriana, Chedraui', food:'Rappi, Uber Eats, DiDi Food', prop:'Inmuebles24, Vivanuncios', car:'your state’s vehicle office (tenencia, refrendo, verificación)', health:'the IMSS or ISSSTE', news:'El Universal, Reforma, Milenio', exams:'the EXANI (CENEVAL)', telco:'Telcel, AT&T México, Movistar', post:'Correos de México, Estafeta, DHL', weather:'the Servicio Meteorológico Nacional' },
  BR: { cur:'BRL', tax:'the Receita Federal', gov:'gov.br', id:'the Polícia Federal (passports)', banks:'Itaú, Banco do Brasil, Bradesco, Caixa, Nubank', pay:'Pix', jobs:'LinkedIn, Indeed, Catho, Gupy', shop:'Mercado Livre, Amazon.com.br, Magazine Luiza', groc:'Carrefour, Assaí, Pão de Açúcar', food:'iFood, Rappi', prop:'Zap Imóveis, Viva Real, QuintoAndar', car:'your state Detran (IPVA and licenciamento)', health:'the SUS or your plano de saúde', news:'Folha de S.Paulo, O Globo, g1', exams:'the ENEM', uni:'SISU and ProUni', telco:'Vivo, Claro, TIM', post:'Correios', weather:'INMET' },
  AR: { cur:'ARS', tax:'ARCA (formerly AFIP)', gov:'Mi Argentina', id:'RENAPER (DNI and passport)', banks:'Banco Nación, Galicia, Santander, BBVA, Macro', pay:'Mercado Pago, transfers by CBU or CVU', jobs:'Bumeran, ZonaJobs, Computrabajo, LinkedIn', shop:'Mercado Libre', groc:'Carrefour, Coto, Día, Jumbo', food:'PedidosYa, Rappi', rail:'Trenes Argentinos', prop:'Zonaprop, Argenprop', car:'the DNRPA and the VTV inspection', health:'your obra social or prepaga', news:'Clarín, La Nación, Infobae', telco:'Personal, Claro, Movistar', post:'Correo Argentino, Andreani', weather:'the Servicio Meteorológico Nacional' },
  DE: { cur:'EUR', tax:'the Finanzamt (ELSTER)', gov:'BundID and the eID function', id:'your Bürgeramt (Personalausweis and passport)', banks:'Sparkasse, Deutsche Bank, Commerzbank, ING, DKB', pay:'PayPal, Wero', jobs:'StepStone, Indeed, LinkedIn, XING, the Bundesagentur für Arbeit', shop:'Amazon.de, Otto, Zalando, MediaMarkt', groc:'Edeka, Rewe, Aldi, Lidl, Kaufland', food:'Lieferando, Wolt', rail:'Deutsche Bahn', prop:'ImmobilienScout24, Immowelt, Kleinanzeigen', car:'the Zulassungsstelle, Kfz-Steuer and the TÜV inspection', health:'your Krankenkasse', news:'Tagesschau, Der Spiegel, FAZ, Süddeutsche Zeitung', exams:'the Abitur', uni:'hochschulstart.de and uni-assist', telco:'Telekom, Vodafone, O2', post:'Deutsche Post and DHL, Hermes, DPD', weather:'the Deutscher Wetterdienst' },
  GB: { cur:'GBP', tax:'HMRC', gov:'GOV.UK One Login', id:'HM Passport Office', banks:'Barclays, HSBC, Lloyds, NatWest, Santander, Monzo', pay:'Faster Payments, PayPal', jobs:'Indeed, LinkedIn, Reed, Totaljobs', shop:'Amazon.co.uk, Argos, John Lewis', groc:'Tesco, Sainsbury’s, Asda, Aldi, Lidl', food:'Deliveroo, Just Eat, Uber Eats', rail:'National Rail and Trainline', prop:'Rightmove, Zoopla', car:'the DVLA (vehicle tax) and the MOT', health:'the NHS (NHS App)', news:'BBC News, The Guardian, The Times', exams:'GCSEs and A-levels', uni:'UCAS', telco:'EE, Vodafone, O2, Three', post:'Royal Mail, Evri, DPD', weather:'the Met Office' },
  FR: { cur:'EUR', tax:'the DGFiP (impots.gouv.fr)', gov:'FranceConnect', id:'the ANTS (passports, ID cards, licences)', banks:'BNP Paribas, Crédit Agricole, Société Générale, LCL, La Banque Postale, Boursorama', pay:'Wero, Lydia', jobs:'France Travail, Indeed, LinkedIn, Welcome to the Jungle', shop:'Amazon.fr, Cdiscount, Fnac, Leboncoin', groc:'Carrefour, E.Leclerc, Intermarché, Auchan, Lidl', food:'Uber Eats, Deliveroo', rail:'SNCF', prop:'SeLoger, Leboncoin', car:'the ANTS (carte grise) and the contrôle technique', health:'the Assurance Maladie (ameli) and your mutuelle', news:'Le Monde, Le Figaro, franceinfo', exams:'the baccalauréat and the brevet', uni:'Parcoursup', telco:'Orange, SFR, Bouygues Telecom, Free', post:'La Poste, Colissimo, Chronopost', weather:'Météo-France' },
  IT: { cur:'EUR', tax:'the Agenzia delle Entrate', gov:'SPID or CIE', id:'your Comune (carta d’identità) and the Questura (passport)', banks:'Intesa Sanpaolo, UniCredit, BPER, Banco BPM, Poste Italiane', pay:'Satispay, PostePay', jobs:'InfoJobs, Indeed, LinkedIn', shop:'Amazon.it, eBay, Unieuro', groc:'Esselunga, Conad, Coop, Carrefour, Lidl', food:'Glovo, Deliveroo, Just Eat', rail:'Trenitalia, Italo', prop:'Immobiliare.it, Idealista', car:'the bollo auto and the revisione', health:'the SSN via your ASL, and the Fascicolo Sanitario', news:'Corriere della Sera, la Repubblica, ANSA', exams:'the esame di maturità', uni:'Universitaly', telco:'TIM, Vodafone, WindTre, Iliad', post:'Poste Italiane, BRT, SDA', weather:'the Aeronautica Militare weather service' },
  RU: { cur:'RUB', tax:'the Federal Tax Service (FNS)', gov:'Gosuslugi', id:'the MVD (passports)', banks:'Sberbank, VTB, T-Bank, Alfa-Bank', pay:'SBP fast payments', jobs:'hh.ru, SuperJob, Avito', shop:'Ozon, Wildberries, Yandex Market', groc:'Pyaterochka, Magnit, Perekrestok', food:'Yandex Eda, Samokat', rail:'RZD', prop:'Cian, Avito', car:'the GIBDD', health:'your OMS policy', news:'Interfax, RBC, Kommersant', exams:'the EGE', telco:'MTS, MegaFon, Beeline, T2', post:'Russian Post, CDEK', weather:'Roshydromet' },
  CN: { cur:'CNY', tax:'the State Taxation Administration (the individual income tax app)', id:'the exit-entry administration (passports)', banks:'ICBC, China Construction Bank, Agricultural Bank of China, Bank of China', pay:'Alipay, WeChat Pay', jobs:'BOSS Zhipin, 51job, Zhaopin, Liepin', shop:'Taobao, JD.com, Pinduoduo', groc:'Hema, RT-Mart', food:'Meituan, Ele.me', rail:'12306 (China Railway)', prop:'Lianjia, Anjuke', car:'the traffic management bureau (12123 app)', health:'your medical insurance (yibao)', news:'Xinhua, Caixin', exams:'the gaokao', telco:'China Mobile, China Unicom, China Telecom', post:'SF Express, China Post, JD Logistics', weather:'the China Meteorological Administration' },
  IN: { cur:'INR', tax:'the Income Tax Department (e-filing portal)', gov:'DigiLocker and UMANG', id:'Passport Seva and UIDAI (Aadhaar)', banks:'SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak', pay:'UPI (PhonePe, Google Pay, Paytm)', jobs:'Naukri, LinkedIn, Indeed, foundit', shop:'Amazon.in, Flipkart, Meesho', groc:'Blinkit, Zepto, BigBasket, DMart', food:'Swiggy, Zomato', rail:'IRCTC (Indian Railways)', prop:'MagicBricks, 99acres, NoBroker', car:'Parivahan (your RTO)', health:'Ayushman Bharat (ABHA) and your insurer', news:'The Hindu, The Times of India, The Indian Express', exams:'CBSE and state board exams, JEE and NEET', uni:'CUET', telco:'Jio, Airtel, Vi', post:'India Post, Delhivery, Blue Dart', weather:'the IMD' },
  JP: { cur:'JPY', tax:'the National Tax Agency (e-Tax)', gov:'Mynaportal (My Number)', id:'your prefectural passport office', banks:'MUFG, SMBC, Mizuho, Japan Post Bank, Rakuten Bank', pay:'PayPay, Suica, Rakuten Pay', jobs:'Indeed, doda, Rikunabi, Mynavi, BizReach', shop:'Amazon.co.jp, Rakuten, Yahoo! Shopping, Mercari', groc:'AEON, Ito-Yokado, Seven-Eleven', food:'Uber Eats, Demae-can', rail:'JR and SmartEX', prop:'SUUMO, LIFULL HOME’S', car:'the shaken inspection and automobile tax', health:'your health insurance (kenkō hoken)', news:'NHK, Asahi Shimbun, Nikkei', exams:'the Common Test for university admissions', telco:'NTT docomo, au, SoftBank, Rakuten Mobile', post:'Japan Post, Yamato, Sagawa', weather:'the Japan Meteorological Agency' },
  KR: { cur:'KRW', tax:'the National Tax Service (Hometax)', gov:'Gov24', id:'your local passport office', banks:'KB Kookmin, Shinhan, Hana, Woori, KakaoBank, Toss Bank', pay:'Toss, KakaoPay, Naver Pay', jobs:'Saramin, JobKorea, Wanted, LinkedIn', shop:'Coupang, Naver Shopping, Gmarket', groc:'E-Mart, Homeplus, Lotte Mart, Market Kurly', food:'Baemin, Coupang Eats, Yogiyo', rail:'Korail and SRT', prop:'Naver Real Estate, Zigbang', car:'the vehicle inspection (TS) and automobile tax', health:'the National Health Insurance Service', news:'Yonhap, Chosun Ilbo, JoongAng Ilbo, Hankyoreh', exams:'the Suneung (CSAT)', telco:'SK Telecom, KT, LG U+', post:'Korea Post, CJ Logistics', weather:'the Korea Meteorological Administration' },
  ID: { cur:'IDR', tax:'the DJP (Coretax)', id:'the immigration office (passports) and Dukcapil (KTP)', banks:'BCA, Mandiri, BRI, BNI', pay:'GoPay, OVO, DANA, QRIS', jobs:'JobStreet, LinkedIn, Glints', shop:'Shopee, Tokopedia, Lazada', groc:'Alfamart, Indomaret', food:'GoFood, GrabFood, ShopeeFood', rail:'KAI Access', prop:'Rumah123, 99.co', car:'Samsat (vehicle tax)', health:'BPJS Kesehatan', news:'Kompas, Detik, Tempo', exams:'the UTBK-SNBT', uni:'SNPMB', telco:'Telkomsel, Indosat Ooredoo, XL', post:'JNE, J&T, SiCepat, Pos Indonesia', weather:'BMKG' },
  SA: { cur:'SAR', tax:'ZATCA (zakat and VAT)', gov:'Absher and Nafath', id:'the Passports department (through Absher)', banks:'Al Rajhi, SNB, Riyad Bank, SAB', pay:'STC Pay, mada, Apple Pay', jobs:'LinkedIn, Bayt, Jadarat', shop:'Amazon.sa, Noon', groc:'Panda, Tamimi, Danube, Othaim', food:'HungerStation, Jahez, Mrsool', rail:'Saudi Arabia Railways', prop:'Aqar', car:'Absher (istimara renewal) and the MVPI inspection', health:'Sehhaty', news:'Arab News, Saudi Gazette', exams:'the Qiyas tests', telco:'STC, Mobily, Zain', post:'SPL, Aramex, SMSA', weather:'the National Center for Meteorology' },
  NG: { cur:'NGN', tax:'the Nigeria Revenue Service (NRS, formerly FIRS) and your state internal revenue service', id:'NIMC (NIN) and the Immigration Service (passports)', banks:'Access Bank, GTBank, Zenith, First Bank, UBA, OPay, Moniepoint', pay:'bank transfers, OPay, PalmPay', jobs:'Jobberman, LinkedIn, MyJobMag', shop:'Jumia, Konga', groc:'Shoprite, Spar', food:'Chowdeck, Glovo', rail:'the NRC', prop:'PropertyPro, Nigeria Property Centre', car:'your vehicle licence and roadworthiness renewals', health:'the NHIA or your HMO', news:'Punch, Premium Times, The Guardian Nigeria', exams:'WAEC, NECO and the JAMB UTME', uni:'JAMB CAPS', telco:'MTN, Airtel, Glo', post:'NIPOST, GIG Logistics, DHL', weather:'NiMet' },
  ZA: { cur:'ZAR', tax:'SARS (eFiling)', id:'Home Affairs', banks:'Standard Bank, FNB, Absa, Nedbank, Capitec', pay:'instant EFT, PayShap', jobs:'PNet, LinkedIn, Careers24', shop:'Takealot, Amazon.co.za', groc:'Checkers, Pick n Pay, Woolworths, Shoprite', food:'Uber Eats, Mr D', prop:'Property24, Private Property', car:'your licence disc renewal (eNaTIS)', health:'your medical aid scheme', news:'News24, Daily Maverick, Business Day', exams:'the NSC matric exams', telco:'Vodacom, MTN, Cell C, Telkom', post:'The Courier Guy, Aramex', weather:'the South African Weather Service' },
  EG: { cur:'EGP', tax:'the Egyptian Tax Authority', gov:'Digital Egypt', banks:'National Bank of Egypt, Banque Misr, CIB', pay:'InstaPay, Vodafone Cash', jobs:'Wuzzuf, LinkedIn, Bayt', shop:'Amazon.eg, Noon, Jumia', groc:'Carrefour, Spinneys', food:'Talabat, Elmenus', rail:'Egyptian National Railways', prop:'Property Finder, Aqarmap', car:'the traffic department (licence renewals)', news:'Ahram Online, Al-Masry Al-Youm', exams:'the Thanaweya Amma', telco:'Vodafone, Orange, e&, WE', post:'Egypt Post, Aramex', weather:'the Egyptian Meteorological Authority' },
  AU: { cur:'AUD', tax:'the ATO (through myGov)', gov:'myGov and myID', id:'the Australian Passport Office', banks:'CommBank, Westpac, NAB, ANZ', pay:'PayID and Osko', jobs:'Seek, LinkedIn, Indeed', shop:'Amazon.com.au, JB Hi-Fi, Kmart', groc:'Woolworths, Coles, Aldi', food:'Uber Eats, DoorDash, Menulog', prop:'realestate.com.au, Domain', car:'your state rego (Service NSW, VicRoads and others)', health:'Medicare and your private health fund', news:'ABC News, The Sydney Morning Herald, The Australian', exams:'the HSC, VCE and ATAR', uni:'UAC, VTAC and your state admissions centre', telco:'Telstra, Optus, Vodafone', post:'Australia Post', weather:'the Bureau of Meteorology' },
  AT: { cur:'EUR', tax:'FinanzOnline', gov:'ID Austria', id:'your Bezirkshauptmannschaft or Magistrat', banks:'Erste Bank and Sparkasse, Raiffeisen, Bank Austria, BAWAG', jobs:'karriere.at, the AMS, StepStone, willhaben', shop:'Amazon.de, willhaben', groc:'Billa, Spar, Hofer, Lidl', food:'foodora, Lieferando', rail:'ÖBB', prop:'willhaben, ImmoScout24', car:'the Pickerl inspection', health:'the ÖGK and your e-card', news:'ORF, Der Standard, Die Presse', exams:'the Matura', telco:'A1, Magenta, Drei', post:'Österreichische Post', weather:'GeoSphere Austria' },
  BE: { cur:'EUR', tax:'the FPS Finance (MyMinfin, Tax-on-web)', gov:'itsme and the eID', id:'your commune or gemeente', banks:'BNP Paribas Fortis, KBC, Belfius, ING', pay:'Payconiq, Wero', jobs:'VDAB, Le Forem, Actiris, StepStone, Indeed', shop:'Bol.com, Coolblue, Amazon', groc:'Delhaize, Colruyt, Carrefour, Aldi', food:'Uber Eats, Deliveroo, Takeaway.com', rail:'SNCB/NMBS', prop:'Immoweb, Zimmo', car:'the technical inspection (contrôle technique / keuring)', health:'your mutuelle or ziekenfonds', news:'VRT, RTBF, Le Soir, De Standaard', telco:'Proximus, Orange, Telenet', post:'bpost', weather:'the RMI' },
  CZ: { cur:'CZK', tax:'the Financial Administration (Finanční správa)', gov:'the Citizen Portal and BankID', id:'your municipal office', banks:'ČSOB, Česká spořitelna, Komerční banka, Raiffeisen, Air Bank', pay:'QR payments', jobs:'Jobs.cz, Prace.cz', shop:'Alza, Allegro, Heureka', groc:'Albert, Billa, Kaufland, Lidl', food:'Wolt, Foodora, Bolt Food', rail:'České dráhy, RegioJet', prop:'Sreality, Bezrealitky', car:'the STK inspection and the highway vignette', health:'your health insurer (VZP and others)', news:'ČT24, iROZHLAS, Seznam Zprávy', exams:'the maturita', telco:'O2, T-Mobile, Vodafone', post:'Česká pošta, Zásilkovna, PPL', weather:'ČHMÚ' },
  DK: { cur:'DKK', tax:'Skattestyrelsen (skat.dk)', gov:'MitID and borger.dk', id:'your kommune', banks:'Danske Bank, Nordea, Jyske Bank', pay:'MobilePay', jobs:'Jobindex, LinkedIn', shop:'Elgiganten, Proshop', groc:'Netto, Føtex, Rema 1000, Lidl', food:'Wolt, Just Eat', rail:'DSB and Rejsekort', prop:'Boligsiden, BoligPortal', car:'Motorstyrelsen and the syn inspection', health:'sundhed.dk and MinLæge', news:'DR, Politiken, Berlingske', uni:'optagelse.dk', telco:'TDC, Telenor, Norlys, 3', post:'PostNord, GLS', weather:'DMI' },
  FI: { cur:'EUR', tax:'Vero (OmaVero)', gov:'Suomi.fi', id:'the police (passports and ID cards)', banks:'Nordea, OP, Danske Bank, S-Pankki', pay:'MobilePay', jobs:'Duunitori, Oikotie, Job Market Finland', shop:'Verkkokauppa.com, Gigantti, Tori', groc:'K-Market, S-Market, Prisma, Lidl', food:'Wolt, Foodora', rail:'VR', prop:'Oikotie, Etuovi', car:'Traficom and the katsastus inspection', health:'your wellbeing services county and Kela', news:'Yle, Helsingin Sanomat', exams:'the matriculation examination', uni:'Studyinfo', telco:'Elisa, DNA, Telia', post:'Posti', weather:'the Finnish Meteorological Institute' },
  IE: { cur:'EUR', tax:'Revenue (myAccount, ROS)', gov:'MyGovID', id:'the Passport Office', banks:'AIB, Bank of Ireland, PTSB, Revolut', pay:'Revolut', jobs:'IrishJobs, Jobs.ie, Indeed, LinkedIn', shop:'Amazon, Argos, Currys', groc:'Tesco, Dunnes Stores, SuperValu, Lidl, Aldi', food:'Deliveroo, Just Eat', rail:'Irish Rail and the Leap card', prop:'Daft.ie, MyHome.ie', car:'motor tax and the NCT', health:'the HSE and your health insurer', news:'RTÉ, The Irish Times, Irish Independent', exams:'the Leaving Cert and Junior Cycle', uni:'the CAO', telco:'Vodafone, Three, eir', post:'An Post', weather:'Met Éireann' },
  NL: { cur:'EUR', tax:'the Belastingdienst', gov:'DigiD', id:'your gemeente', banks:'ING, Rabobank, ABN AMRO, bunq', pay:'iDEAL, Tikkie', jobs:'Indeed, LinkedIn, Nationale Vacaturebank', shop:'Bol.com, Coolblue, Amazon.nl', groc:'Albert Heijn, Jumbo, Lidl, Aldi', food:'Thuisbezorgd, Uber Eats', rail:'NS and the OV-chipkaart', prop:'Funda, Pararius', car:'the RDW (APK) and motor vehicle tax', health:'your zorgverzekeraar', news:'NOS, NRC, de Volkskrant', exams:'the eindexamen', uni:'Studielink', telco:'KPN, Vodafone, Odido', post:'PostNL, DHL', weather:'the KNMI' },
  NO: { cur:'NOK', tax:'Skatteetaten', gov:'ID-porten and BankID', id:'the police (passports)', banks:'DNB, SpareBank 1, Nordea, Handelsbanken', pay:'Vipps', jobs:'FINN jobb, NAV, LinkedIn', shop:'Komplett, Elkjøp, FINN torget', groc:'Rema 1000, Kiwi, Coop, Meny', food:'Foodora, Wolt', rail:'Vy and Entur', prop:'FINN eiendom', car:'Statens vegvesen (EU-kontroll)', health:'Helsenorge and your fastlege', news:'NRK, VG, Aftenposten', uni:'Samordna opptak', telco:'Telenor, Telia, Ice', post:'Posten and Bring', weather:'the Norwegian Meteorological Institute (Yr)' },
  PL: { cur:'PLN', tax:'the KAS (e-Urząd Skarbowy)', gov:'mObywatel and Profil Zaufany', id:'your municipal office and voivodeship passport office', banks:'PKO BP, Pekao, mBank, ING, Santander', pay:'BLIK', jobs:'Pracuj.pl, OLX Praca, LinkedIn', shop:'Allegro, Amazon.pl, OLX', groc:'Biedronka, Lidl, Żabka, Kaufland', food:'Pyszne.pl, Glovo, Wolt, Uber Eats', rail:'PKP Intercity', prop:'Otodom, OLX', car:'the technical inspection and CEPiK', health:'the NFZ and IKP', news:'TVN24, Gazeta Wyborcza, Onet', exams:'the matura and the egzamin ósmoklasisty', telco:'Orange, Play, Plus, T-Mobile', post:'InPost, Poczta Polska, DPD', weather:'IMGW' },
  PT: { cur:'EUR', tax:'the Autoridade Tributária (Portal das Finanças)', gov:'Chave Móvel Digital', id:'the IRN (Cartão de Cidadão and passports)', banks:'Caixa Geral de Depósitos, Millennium bcp, Santander, Novo Banco, BPI', pay:'MB WAY', jobs:'Net-Empregos, the IEFP, LinkedIn', shop:'Worten, OLX', groc:'Continente, Pingo Doce, Lidl, Auchan', food:'Glovo, Uber Eats, Bolt Food', rail:'CP (Comboios de Portugal)', prop:'Idealista, Imovirtual', car:'the IUC and the inspeção periódica', health:'the SNS 24', news:'Público, Expresso, RTP', exams:'the exames nacionais', uni:'the Concurso Nacional de Acesso (DGES)', telco:'MEO, NOS, Vodafone', post:'CTT', weather:'the IPMA' },
  ES: { cur:'EUR', tax:'the Agencia Tributaria (AEAT)', gov:'Cl@ve and your digital certificate', id:'the Policía Nacional (DNI and passport, by cita previa)', banks:'Santander, BBVA, CaixaBank, Sabadell, ING', pay:'Bizum', jobs:'InfoJobs, LinkedIn, Indeed, the SEPE', shop:'Amazon.es, El Corte Inglés, Wallapop', groc:'Mercadona, Carrefour, Lidl, Dia', food:'Glovo, Just Eat, Uber Eats', rail:'Renfe, Ouigo and Iryo', prop:'Idealista, Fotocasa', car:'the DGT, the IVTM and the ITV', health:'your regional health service', news:'El País, El Mundo, RTVE', exams:'the PAU (Selectividad)', telco:'Movistar, Vodafone, Orange, MásMóvil', post:'Correos, SEUR', weather:'AEMET' },
  SE: { cur:'SEK', tax:'Skatteverket', gov:'BankID', id:'the police (passports)', banks:'Swedbank, SEB, Handelsbanken, Nordea', pay:'Swish', jobs:'Arbetsförmedlingen, LinkedIn, Indeed', shop:'Elgiganten, Blocket', groc:'ICA, Coop, Willys, Lidl', food:'Foodora, Wolt, Uber Eats', rail:'SJ', prop:'Hemnet, Blocket Bostad', car:'Transportstyrelsen and the besiktning', health:'1177 and your region', news:'SVT, Dagens Nyheter, Svenska Dagbladet', exams:'the national tests and the högskoleprovet', uni:'Antagning.se', telco:'Telia, Tele2, Telenor, Tre', post:'PostNord', weather:'SMHI' },
  CH: { cur:'CHF', tax:'your cantonal tax administration', gov:'AGOV', id:'your cantonal passport office', banks:'UBS, Raiffeisen, PostFinance, your cantonal bank', pay:'TWINT', jobs:'jobs.ch, LinkedIn, Indeed', shop:'Galaxus, Digitec, Ricardo', groc:'Migros, Coop, Denner, Aldi, Lidl', food:'Uber Eats, Just Eat', rail:'SBB', prop:'Homegate, ImmoScout24, Comparis', car:'your cantonal road traffic office', health:'your basic health insurer', news:'SRF, NZZ, Tages-Anzeiger, RTS', exams:'the Matura', telco:'Swisscom, Sunrise, Salt', post:'Swiss Post', weather:'MeteoSwiss' },
  TR: { cur:'TRY', tax:'the Revenue Administration (GİB)', gov:'e-Devlet', id:'the NVİ (ID cards and passports)', banks:'Ziraat, İş Bankası, Garanti BBVA, Akbank, Yapı Kredi', pay:'FAST transfers', jobs:'Kariyer.net, LinkedIn, Indeed', shop:'Trendyol, Hepsiburada, Amazon.com.tr', groc:'Migros, BİM, A101, ŞOK', food:'Yemeksepeti, Getir', rail:'TCDD Taşımacılık', prop:'Sahibinden, Emlakjet', car:'the TÜVTÜRK inspection and the MTV tax', health:'e-Nabız and MHRS', news:'Hürriyet, Sözcü, NTV', exams:'the YKS', uni:'ÖSYM', telco:'Turkcell, Vodafone, Türk Telekom', post:'PTT, Yurtiçi Kargo, Aras Kargo', weather:'the MGM' },
  UA: { cur:'UAH', tax:'the State Tax Service', gov:'Diia', id:'the State Migration Service', banks:'PrivatBank, monobank, Oschadbank, Raiffeisen', pay:'monobank transfers', jobs:'Work.ua, robota.ua, Djinni', shop:'Rozetka, Prom.ua, OLX', groc:'Silpo, ATB, Novus', food:'Glovo, Bolt Food', rail:'Ukrzaliznytsia', prop:'DIM.RIA, OLX', car:'the MVS service centres', health:'Helsi and your declared doctor', news:'Ukrainska Pravda, Suspilne', exams:'the NMT', telco:'Kyivstar, Vodafone, lifecell', post:'Nova Poshta, Ukrposhta', weather:'the Ukrainian Hydrometeorological Center' },
  HK: { cur:'HKD', tax:'the Inland Revenue Department (eTAX)', gov:'iAM Smart', id:'the Immigration Department', banks:'HSBC, Hang Seng, Bank of China (Hong Kong), Standard Chartered', pay:'FPS, Octopus, PayMe', jobs:'JobsDB, LinkedIn, CTgoodjobs', shop:'HKTVmall, Taobao', groc:'Wellcome, ParknShop', food:'Foodpanda, Keeta', rail:'MTR', prop:'28Hse, Centaline, Spacious', car:'the Transport Department (vehicle licence)', health:'the Hospital Authority (HA Go)', news:'RTHK, SCMP, Ming Pao', exams:'the HKDSE', uni:'JUPAS', telco:'CSL, China Mobile Hong Kong, 3, SmarTone', post:'Hongkong Post, SF Express', weather:'the Hong Kong Observatory' },
  IL: { cur:'ILS', tax:'the Israel Tax Authority', gov:'your gov.il personal area', id:'the Population and Immigration Authority', banks:'Leumi, Hapoalim, Discount, Mizrahi-Tefahot', pay:'Bit, PayBox', jobs:'AllJobs, Drushim, LinkedIn', shop:'KSP, Zap', groc:'Shufersal, Rami Levy, Victory', food:'Wolt, 10bis', rail:'Israel Railways', prop:'Yad2, Madlan', car:'the Licensing Office (annual test and licence)', health:'your kupat holim (Clalit, Maccabi, Meuhedet, Leumit)', news:'Ynet, Haaretz, The Times of Israel', exams:'the Bagrut and the psychometric exam', telco:'Partner, Cellcom, Pelephone', post:'Israel Post', weather:'the Israel Meteorological Service' },
  MY: { cur:'MYR', tax:'LHDN (MyTax, e-Filing)', gov:'MyDigital ID', id:'the Immigration Department and JPN (MyKad)', banks:'Maybank, CIMB, Public Bank, RHB, Hong Leong', pay:'DuitNow, Touch ’n Go eWallet', jobs:'JobStreet, LinkedIn, Hiredly', shop:'Shopee, Lazada', groc:'Lotus’s, Jaya Grocer, Mydin, 99 Speedmart', food:'GrabFood, Foodpanda', rail:'KTMB and Rapid KL', prop:'PropertyGuru, iProperty', car:'JPJ (road tax) and Puspakom', news:'The Star, Malaysiakini, Berita Harian', exams:'SPM and STPM', uni:'UPU', telco:'Maxis, CelcomDigi, U Mobile', post:'Pos Malaysia, J&T', weather:'MetMalaysia' },
  PH: { cur:'PHP', tax:'the BIR', gov:'eGovPH', id:'the DFA (passports) and PhilSys (national ID)', banks:'BDO, BPI, Metrobank, Landbank', pay:'GCash, Maya, InstaPay', jobs:'JobStreet, LinkedIn, Kalibrr', shop:'Shopee, Lazada', groc:'SM Supermarket, Puregold, Robinsons', food:'GrabFood, Foodpanda', rail:'the LRT and MRT', prop:'Lamudi, Dot Property', car:'the LTO', health:'PhilHealth', news:'Rappler, the Inquirer, ABS-CBN', telco:'Globe, Smart, DITO', post:'PHLPost, LBC, J&T', weather:'PAGASA' },
  SG: { cur:'SGD', tax:'IRAS', gov:'Singpass', id:'the ICA', banks:'DBS/POSB, OCBC, UOB', pay:'PayNow, GrabPay', jobs:'MyCareersFuture, JobStreet, LinkedIn', shop:'Shopee, Lazada, Amazon.sg', groc:'NTUC FairPrice, Cold Storage, Sheng Siong', food:'GrabFood, Foodpanda, Deliveroo', rail:'the MRT (SMRT and SBS Transit)', prop:'PropertyGuru, 99.co', car:'the LTA (road tax and COE)', health:'HealthHub and your polyclinic', news:'The Straits Times, CNA', exams:'the PSLE, O-Levels and A-Levels', telco:'Singtel, StarHub, M1', post:'SingPost, Ninja Van', weather:'the Meteorological Service Singapore' },
  TW: { cur:'TWD', tax:'the Ministry of Finance e-filing system', id:'the Bureau of Consular Affairs (passports)', banks:'CTBC, Cathay United, E.SUN, Taishin', pay:'LINE Pay, JKOPAY', jobs:'104 Job Bank, 1111, LinkedIn', shop:'Shopee, PChome, momo', groc:'PX Mart, Carrefour, 7-Eleven, FamilyMart', food:'Uber Eats, Foodpanda', rail:'the THSR and Taiwan Railway', prop:'591, Sinyi', car:'the Motor Vehicles Office', health:'the National Health Insurance', news:'CNA, Liberty Times, United Daily News', exams:'the GSAT and AST', telco:'Chunghwa Telecom, Taiwan Mobile, FarEasTone', post:'Chunghwa Post', weather:'the Central Weather Administration' },
  TH: { cur:'THB', tax:'the Revenue Department', id:'the Department of Consular Affairs (passports)', banks:'Kasikornbank, SCB, Bangkok Bank, Krungthai', pay:'PromptPay, TrueMoney', jobs:'JobsDB, JobThai, LinkedIn', shop:'Shopee, Lazada', groc:'Lotus’s, Big C, Tops, 7-Eleven', food:'GrabFood, LINE MAN', rail:'the SRT, BTS and MRT', prop:'DDproperty, Hipflat', car:'the Department of Land Transport (vehicle tax)', news:'Bangkok Post, Thai PBS', exams:'TGAT and TPAT', uni:'TCAS', telco:'AIS, True, NT', post:'Thailand Post, Flash Express', weather:'the Thai Meteorological Department' },
  AE: { cur:'AED', tax:'the Federal Tax Authority', gov:'UAE Pass', id:'the ICP (Emirates ID and residency)', banks:'Emirates NBD, FAB, ADCB, Mashreq, DIB', pay:'Apple Pay, Aani', jobs:'LinkedIn, Bayt, Naukrigulf, Dubizzle', shop:'Amazon.ae, Noon', groc:'Carrefour, Lulu, Spinneys, Union Coop', food:'Talabat, Deliveroo, Careem', rail:'the Dubai Metro', prop:'Property Finder, Bayut, Dubizzle', car:'your emirate’s traffic authority (RTA in Dubai) and Salik', health:'your health insurer and the DHA or DOH', news:'The National, Gulf News, Khaleej Times', exams:'EmSAT', telco:'e&, du', post:'Emirates Post, Aramex', weather:'the National Center of Meteorology' },
  VN: { cur:'VND', tax:'the tax authority (eTax)', gov:'VNeID', id:'the Immigration Department', banks:'Vietcombank, VietinBank, BIDV, Techcombank, MB', pay:'MoMo, ZaloPay, VietQR', jobs:'TopCV, VietnamWorks, ITviec', shop:'Shopee, Lazada, Tiki, TikTok Shop', groc:'WinMart, Co.opmart, Bách Hóa Xanh', food:'GrabFood, ShopeeFood', rail:'Vietnam Railways', prop:'Batdongsan.com.vn, Chợ Tốt', car:'vehicle registration and đăng kiểm inspection', health:'your social health insurance (BHYT)', news:'VnExpress, Tuổi Trẻ, Thanh Niên', exams:'the national high school graduation exam', telco:'Viettel, Vinaphone, MobiFone', post:'VNPost, Viettel Post, GHN', weather:'the National Center for Hydro-Meteorological Forecasting' },
  KE: { cur:'KES', tax:'KRA (iTax)', gov:'eCitizen', id:'the Directorate of Immigration and the NRB', banks:'KCB, Equity, Co-op Bank, NCBA, Absa Kenya', pay:'M-Pesa', jobs:'BrighterMonday, LinkedIn, MyJobMag', shop:'Jumia, Kilimall', groc:'Naivas, Quickmart, Carrefour', food:'Glovo', rail:'the SGR Madaraka Express', prop:'BuyRentKenya', car:'the NTSA', health:'the SHA', news:'Nation, The Standard, Citizen Digital', exams:'the KCSE', uni:'KUCCPS', telco:'Safaricom, Airtel, Telkom', post:'Posta Kenya', weather:'the Kenya Meteorological Department' },
  PK: { cur:'PKR', tax:'the FBR (IRIS)', id:'NADRA and the passport office', banks:'HBL, UBL, MCB, Meezan, Allied Bank', pay:'Easypaisa, JazzCash, Raast', jobs:'Rozee.pk, LinkedIn', shop:'Daraz', groc:'Imtiaz, Carrefour, Naheed', food:'Foodpanda', rail:'Pakistan Railways', prop:'Zameen, Graana', car:'the Excise and Taxation department (token tax)', news:'Dawn, The Express Tribune, Geo', exams:'the matric and intermediate board exams, MDCAT and ECAT', telco:'Jazz, Zong, Ufone', post:'Pakistan Post, TCS, Leopards', weather:'the PMD' },
  BD: { cur:'BDT', tax:'the NBR (e-return)', id:'the Election Commission (NID) and the passport office', banks:'Sonali Bank, BRAC Bank, Dutch-Bangla Bank, Islami Bank', pay:'bKash, Nagad, Rocket', jobs:'Bdjobs, LinkedIn', shop:'Daraz, Rokomari', groc:'Chaldal, Shwapno, Meena Bazar', food:'Foodpanda, Pathao Food', rail:'Bangladesh Railway', car:'the BRTA', news:'Prothom Alo, The Daily Star', exams:'the SSC and HSC', telco:'Grameenphone, Robi, Banglalink, Teletalk', post:'Pathao Courier, Sundarban, Bangladesh Post', weather:'the BMD' },
  LK: { cur:'LKR', tax:'the Inland Revenue Department', id:'the Department of Immigration and Emigration, and the DRP (NIC)', banks:'Bank of Ceylon, People’s Bank, Commercial Bank, Sampath, HNB', pay:'LankaPay JustPay', jobs:'TopJobs, LinkedIn', shop:'Daraz, Kapruka', groc:'Keells, Cargills Food City, Arpico', food:'PickMe Food, Uber Eats', rail:'Sri Lanka Railways', prop:'ikman.lk, LankaPropertyWeb', car:'the Department of Motor Traffic (revenue licence)', news:'Daily Mirror, Ada Derana', exams:'the O/L and A/L exams', telco:'Dialog, SLT-Mobitel, Hutch, Airtel', post:'Sri Lanka Post', weather:'the Department of Meteorology' },
  NP: { cur:'NPR', tax:'the Inland Revenue Department', gov:'the Nagarik App', id:'the Department of Passports', banks:'Nabil, Global IME, NIC Asia, Nepal Bank', pay:'eSewa, Khalti, Fonepay', jobs:'Merojob, Kumarijob', shop:'Daraz', groc:'Bhatbhateni', food:'Foodmandu, Pathao', car:'the Department of Transport Management', health:'the Health Insurance Board', news:'The Kathmandu Post, Kantipur', exams:'the SEE and NEB grade 12 exams', telco:'Nepal Telecom, Ncell', post:'Nepal Post', weather:'the Department of Hydrology and Meteorology' },
  KZ: { cur:'KZT', tax:'the State Revenue Committee', gov:'eGov.kz', id:'the Public Service Centres (TsON)', banks:'Kaspi, Halyk, Freedom, ForteBank', pay:'Kaspi', jobs:'hh.kz, Enbek', shop:'Kaspi, Wildberries, Ozon', groc:'Magnum, Small', food:'Glovo, Wolt, Yandex Eda', rail:'KTZ', prop:'Krisha.kz', health:'the compulsory social health insurance (OSMS)', news:'Tengrinews, Kazinform', exams:'the UNT', telco:'Kcell, Beeline, Tele2 and Altel', post:'Kazpost', weather:'Kazhydromet' },
  UZ: { cur:'UZS', tax:'the Tax Committee (my.soliq.uz)', gov:'my.gov.uz', banks:'Kapitalbank, NBU, Hamkorbank, TBC Bank', pay:'Click, Payme, Uzum', jobs:'hh.uz, OLX', shop:'Uzum Market, OLX', groc:'Korzinka, Makro', food:'Yandex Eda, Uzum Tezkor', rail:'Uzbekistan Railways', prop:'OLX, Uybor', news:'Kun.uz, Gazeta.uz', telco:'Beeline, Ucell, Mobiuz, Uzmobile', post:'Uzpost', weather:'Uzhydromet' },
  KH: { cur:'KHR', tax:'the General Department of Taxation', banks:'ABA, ACLEDA, Canadia, Wing', pay:'Bakong, ABA Pay, Wing', jobs:'BongThom, Khmer24', shop:'Khmer24', groc:'Lucky Supermarket, AEON', food:'Foodpanda, Grab, WOWNOW', news:'Khmer Times', exams:'the grade 12 national exam', telco:'Smart, Cellcard, Metfone' },
  MM: { cur:'MMK', banks:'KBZ, AYA, CB Bank', pay:'KBZPay, Wave Money', jobs:'JobNet.com.mm', groc:'City Mart', news:'The Irrawaddy, Myanmar Now, Eleven Media', exams:'the matriculation exam', telco:'MPT, ATOM, Mytel', post:'Myanma Post', weather:'the Department of Meteorology and Hydrology' },
  IQ: { cur:'IQD', tax:'the General Commission for Taxes', gov:'the Ur portal', banks:'Rafidain, Rasheed, TBI', pay:'ZainCash, FastPay, Qi Card', food:'Talabat', news:'Rudaw, Shafaq News, Al Sumaria', exams:'the ministerial (baccalaureate) exams', telco:'Zain, Asiacell, Korek' },
  JO: { cur:'JOD', tax:'the Income and Sales Tax Department', gov:'Sanad', id:'the Civil Status and Passports Department', banks:'Arab Bank, Housing Bank, Jordan Kuwait Bank', pay:'CliQ, eFAWATEERcom', jobs:'Bayt, Akhtaboot, LinkedIn', groc:'Carrefour, Cozmo', food:'Talabat, Careem', prop:'OpenSooq', car:'the Driver and Vehicle Licensing Department', news:'The Jordan Times, Al Ghad, Roya', exams:'the Tawjihi', telco:'Zain, Orange, Umniah', post:'Jordan Post, Aramex', weather:'the Jordan Meteorological Department' },
  QA: { cur:'QAR', tax:'the General Tax Authority (Dhareeba)', gov:'Hukoomi and Metrash', id:'the Ministry of Interior (through Metrash)', banks:'QNB, Commercial Bank, Doha Bank, QIB', jobs:'LinkedIn, Bayt', shop:'Snoonu', groc:'Lulu, Carrefour, Al Meera', food:'Talabat, Snoonu', rail:'the Doha Metro', prop:'Property Finder', car:'Metrash (istimara) and the Fahes inspection', health:'HMC and PHCC', news:'The Peninsula, Gulf Times, Al Jazeera', telco:'Ooredoo, Vodafone', post:'Qatar Post, Aramex', weather:'the Qatar Meteorology Department' },
  KW: { cur:'KWD', gov:'Sahel', id:'PACI (civil ID)', banks:'NBK, KFH, Gulf Bank, Boubyan', jobs:'LinkedIn, Bayt', groc:'The Sultan Center, Lulu, the co-operative societies', food:'Talabat, Deliveroo, Jahez', car:'the Ministry of Interior traffic services (through Sahel)', news:'Kuwait Times, Arab Times, KUNA', telco:'Zain, Ooredoo, stc' },
  OM: { cur:'OMR', tax:'the Tax Authority', id:'the Royal Oman Police', banks:'Bank Muscat, NBO, Sohar International', groc:'Lulu, Carrefour', food:'Talabat', car:'the Royal Oman Police', news:'Times of Oman, Oman Observer', uni:'the Higher Education Admission Centre', telco:'Omantel, Ooredoo, Vodafone', post:'Oman Post' },
  BH: { cur:'BHD', tax:'the National Bureau for Revenue (VAT)', gov:'eGov.bh', id:'the iGA (smart card)', banks:'NBB, BBK, KFH Bahrain', pay:'BenefitPay', groc:'Lulu, Carrefour, Al Jazira', food:'Talabat, Jahez', car:'the General Directorate of Traffic', news:'Gulf Daily News', telco:'Batelco, Zain, stc' },
  LB: { cur:'LBP', tax:'the Ministry of Finance', id:'General Security', pay:'Whish, OMT', groc:'Spinneys', food:'Toters', news:'L’Orient-Le Jour, An-Nahar', exams:'the official Brevet and baccalaureate exams', telco:'Alfa, touch', post:'LibanPost' },
  AZ: { cur:'AZN', tax:'the State Tax Service', gov:'myGov (e-gov.az)', id:'ASAN Xidmət', banks:'Kapital Bank, PASHA Bank, ABB', pay:'Birbank', jobs:'Boss.az, Jobsearch.az', shop:'Tap.az', groc:'Bravo, Araz', food:'Wolt, Bolt Food', rail:'ADY', prop:'Bina.az', news:'APA, Report.az', exams:'the DİM entrance exams', telco:'Azercell, Bakcell, Nar', post:'Azerpost' },
  GE: { cur:'GEL', tax:'the Revenue Service (rs.ge)', gov:'my.gov.ge', id:'the Public Service Hall', banks:'TBC, Bank of Georgia, Liberty', jobs:'jobs.ge, hr.ge', shop:'MyMarket', groc:'Carrefour, Nikora, Spar', food:'Glovo, Wolt, Bolt Food', rail:'Georgian Railway', prop:'MyHome.ge', news:'Civil.ge, InterPressNews', exams:'the Unified National Exams', telco:'Magti, Silknet, Cellfie', post:'Georgian Post' },
  AM: { cur:'AMD', tax:'the State Revenue Committee', gov:'e-gov.am', id:'the Migration and Citizenship Service', banks:'Ameriabank, Ardshinbank, ACBA, Inecobank', pay:'Idram, Telcell', jobs:'staff.am, job.am', groc:'SAS, Yerevan City', food:'Yandex Eda, Glovo, Menu.am', prop:'list.am', news:'Armenpress, Azatutyun, CivilNet', exams:'the unified exams', telco:'Team Telecom, Viva, Ucom', post:'HayPost' },
  MN: { cur:'MNT', tax:'the General Department of Taxation (e-barimt)', gov:'E-Mongolia', banks:'Khan Bank, Golomt, TDB, XacBank', pay:'QPay, SocialPay, Monpay', news:'Montsame, Ikon.mn', exams:'the general entrance exam', telco:'Mobicom, Unitel, Skytel, G-Mobile' },
  NZ: { cur:'NZD', tax:'Inland Revenue (myIR)', gov:'RealMe', id:'the Passport Office (DIA)', banks:'ANZ, ASB, BNZ, Westpac, Kiwibank', jobs:'Seek, Trade Me Jobs, LinkedIn', shop:'Trade Me, The Warehouse, Mighty Ape', groc:'Woolworths, Pak’nSave, New World', food:'Uber Eats, DoorDash', prop:'Trade Me Property, realestate.co.nz', car:'NZTA (rego and WoF)', health:'Health NZ and your GP', news:'RNZ, NZ Herald, Stuff', exams:'NCEA', telco:'Spark, One NZ, 2degrees', post:'NZ Post', weather:'MetService' },
  ET: { cur:'ETB', tax:'the Ministry of Revenues', id:'the Immigration and Citizenship Service, and the Fayda national ID', banks:'Commercial Bank of Ethiopia, Awash, Dashen, Bank of Abyssinia', pay:'telebirr, M-Pesa', jobs:'Ethiojobs', rail:'the Ethio-Djibouti Railway', news:'Addis Standard, The Reporter', exams:'the national secondary school leaving exam', telco:'Ethio Telecom, Safaricom', post:'Ethiopian Postal Service' },
  TZ: { cur:'TZS', tax:'the TRA', id:'NIDA', banks:'CRDB, NMB, NBC', pay:'M-Pesa, Mixx by Yas, Airtel Money', rail:'the TRC (SGR)', car:'the TRA (motor vehicle licence)', health:'the NHIF', news:'The Citizen, Daily News', exams:'the NECTA exams (CSEE and ACSEE)', uni:'the TCU', telco:'Vodacom, Yas, Airtel, Halotel', weather:'the TMA' },
  UG: { cur:'UGX', tax:'the URA', id:'NIRA', banks:'Stanbic, Centenary, dfcu', pay:'MTN MoMo, Airtel Money', shop:'Jumia', car:'the URA (vehicle services)', news:'Daily Monitor, New Vision', exams:'the UNEB exams (UCE and UACE)', telco:'MTN, Airtel', weather:'UNMA' },
  GH: { cur:'GHS', tax:'the GRA', id:'the NIA (Ghana Card) and the passport office', banks:'GCB, Ecobank, Stanbic, Absa, Fidelity', pay:'MTN MoMo, Telecel Cash, AT Money', jobs:'Jobberman', shop:'Jumia', groc:'Melcom', food:'Bolt Food', prop:'Meqasa', car:'the DVLA', health:'the NHIS', news:'Graphic, GhanaWeb, Citi Newsroom', exams:'the BECE and WASSCE', telco:'MTN, Telecel, AT', post:'Ghana Post', weather:'GMet' },
  MA: { cur:'MAD', tax:'the DGI', id:'the DGSN (CNIE and passport)', banks:'Attijariwafa, Bank of Africa, Banque Populaire, CIH', jobs:'Rekrute, LinkedIn', shop:'Jumia, Avito', groc:'Marjane, Carrefour, BIM', food:'Glovo', rail:'the ONCF (Al Boraq)', prop:'Avito, Mubawab', car:'NARSA and the vignette', health:'the CNSS (AMO)', news:'Hespress, Le360, Médias24', exams:'the baccalauréat', telco:'Maroc Telecom, Orange, inwi', post:'Barid Al-Maghrib, Amana', weather:'the DGM' },
  DZ: { cur:'DZD', tax:'the DGI', banks:'BNA, CPA, BEA', pay:'BaridiMob', jobs:'Emploitic', shop:'Ouedkniss', food:'Yassir', rail:'the SNTF', prop:'Ouedkniss', health:'the CNAS', news:'El Watan, TSA', exams:'the baccalauréat', telco:'Mobilis, Djezzy, Ooredoo', post:'Algérie Poste' },
  TN: { cur:'TND', tax:'the DGI', banks:'BIAT, STB, BH Bank, Attijari Bank', jobs:'Tanitjobs, Keejob', shop:'Tayara', groc:'Carrefour, Monoprix, Aziza', rail:'the SNCFT', prop:'Tayara', health:'the CNAM', news:'La Presse, Business News', exams:'the baccalauréat', telco:'Ooredoo, Orange, Tunisie Telecom', post:'La Poste Tunisienne', weather:'the INM' },
  SN: { cur:'XOF', tax:'the DGID', banks:'CBAO, Société Générale Sénégal, Ecobank', pay:'Wave, Orange Money', groc:'Auchan', rail:'the TER Dakar', news:'APS, Le Soleil', exams:'the BFEM and baccalauréat', telco:'Orange, Free, Expresso' },
  CI: { cur:'XOF', tax:'the DGI', pay:'Wave, Orange Money, MTN MoMo', shop:'Jumia', health:'the CMU', news:'Fraternité Matin, Abidjan.net', exams:'the BEPC and baccalauréat', telco:'Orange, MTN, Moov' },
  CM: { cur:'XAF', tax:'the DGI', banks:'Afriland First Bank, SCB Cameroun, Ecobank', pay:'MTN MoMo, Orange Money', post:'Campost', rail:'Camrail', news:'Cameroon Tribune', exams:'the GCE and the baccalauréat', telco:'MTN, Orange, Camtel' },
  ZM: { cur:'ZMW', tax:'the ZRA', banks:'Zanaco, Stanbic, Absa, FNB', pay:'MTN MoMo, Airtel Money', groc:'Shoprite, Pick n Pay', car:'the RTSA', health:'NHIMA', news:'Lusaka Times, Zambia Daily Mail', exams:'the ECZ exams', telco:'MTN, Airtel, Zamtel' },
  ZW: { cur:'ZWG', tax:'ZIMRA', banks:'CBZ, Stanbic, FBC', pay:'EcoCash, OneMoney', groc:'OK Zimbabwe, TM Pick n Pay', car:'ZINARA (vehicle licence)', news:'The Herald, NewsDay', exams:'the ZIMSEC exams', telco:'Econet, NetOne, Telecel' },
  RW: { cur:'RWF', tax:'the RRA', gov:'Irembo', id:'NIDA', banks:'Bank of Kigali, Equity, I&M', pay:'MTN MoMo, Airtel Money', groc:'Simba Supermarket', car:'Irembo (vehicle services)', health:'the Mutuelle de Santé', news:'The New Times, IGIHE', exams:'the NESA national exams', telco:'MTN, Airtel', weather:'Meteo Rwanda' },
  MZ: { cur:'MZN', tax:'the Autoridade Tributária', banks:'Millennium bim, BCI, Standard Bank', pay:'M-Pesa, e-Mola, mKesh', groc:'Shoprite', rail:'CFM', news:'Notícias, O País', telco:'Vodacom, Movitel, Tmcel', weather:'INAM' },
  AO: { cur:'AOA', tax:'the AGT', banks:'BAI, BFA, BIC, Millennium Atlântico', pay:'Multicaixa Express', groc:'Kero, Shoprite, Candando', food:'Tupuca', news:'Jornal de Angola, Novo Jornal', telco:'Unitel, Africell, Movicel', weather:'INAMET' },
  BW: { cur:'BWP', tax:'BURS', banks:'FNB Botswana, Absa, Stanbic', pay:'Orange Money, MyZaka', groc:'Choppies, Spar, Shoprite', news:'Mmegi, Sunday Standard', exams:'the BGCSE', telco:'Mascom, Orange, BTC', post:'BotswanaPost' },
  NA: { cur:'NAD', tax:'NamRA', banks:'Bank Windhoek, FNB Namibia, Standard Bank, Nedbank', groc:'Shoprite, Checkers, Spar, Woermann Brock', rail:'TransNamib', car:'NaTIS', news:'The Namibian, New Era', exams:'the NSSC exams', telco:'MTC, TN Mobile', post:'NamPost' },
  CO: { cur:'COP', tax:'the DIAN', gov:'Carpeta Ciudadana', id:'the Registraduría (cédula) and the Cancillería (passports)', banks:'Bancolombia, Davivienda, Banco de Bogotá, BBVA', pay:'Nequi, Daviplata, Bre-B', jobs:'elempleo, Computrabajo, LinkedIn', shop:'Mercado Libre, Falabella, Éxito', groc:'Éxito, Carulla, D1, Ara', food:'Rappi, DiDi Food', prop:'Finca Raíz, Metrocuadrado', car:'the RUNT, the SOAT and the revisión técnico-mecánica', health:'your EPS', news:'El Tiempo, El Espectador, Semana', exams:'the ICFES Saber 11', telco:'Claro, Movistar, Tigo', post:'4-72, Servientrega, Interrapidísimo', weather:'the IDEAM' },
  PE: { cur:'PEN', tax:'SUNAT', gov:'gob.pe', id:'RENIEC (DNI) and Migraciones (passports)', banks:'BCP, Interbank, BBVA, Scotiabank', pay:'Yape, Plin', jobs:'Bumeran, Computrabajo, LinkedIn', shop:'Mercado Libre, Falabella, Ripley', groc:'Plaza Vea, Tottus, Wong, Metro', food:'PedidosYa, Rappi', prop:'Urbania, Adondevivir', car:'the SAT (vehicle tax) and the technical inspection', health:'EsSalud and the SIS', news:'El Comercio, La República, RPP', telco:'Claro, Movistar, Entel, Bitel', post:'Serpost, Olva', weather:'SENAMHI' },
  CL: { cur:'CLP', tax:'the SII', gov:'ClaveÚnica', id:'the Registro Civil', banks:'BancoEstado, Banco de Chile, Santander, BCI', pay:'Mercado Pago, MACH', jobs:'Laborum, Computrabajo, LinkedIn', shop:'Mercado Libre, Falabella, Paris, Ripley', groc:'Líder, Jumbo, Unimarc, Santa Isabel', food:'PedidosYa, Rappi, Uber Eats', rail:'EFE', prop:'Portal Inmobiliario, Yapo', car:'the permiso de circulación and the revisión técnica', health:'Fonasa or your Isapre', news:'El Mercurio, La Tercera, BioBioChile', exams:'the PAES', uni:'DEMRE', telco:'Entel, Movistar, Claro, WOM', post:'Correos de Chile, Chilexpress, Starken', weather:'the Dirección Meteorológica de Chile' },
  EC: { cur:'USD', tax:'the SRI', id:'the Registro Civil', banks:'Banco Pichincha, Produbanco, Banco Guayaquil, Banco del Pacífico', pay:'DeUna', jobs:'Multitrabajos, Computrabajo', shop:'Mercado Libre', groc:'Supermaxi, Mi Comisariato, Tía', food:'PedidosYa, Rappi', prop:'Plusvalía', car:'the ANT (matriculación)', health:'the IESS', news:'El Comercio, El Universo, Primicias', telco:'Claro, Movistar, CNT', post:'Servientrega', weather:'INAMHI' },
  BO: { cur:'BOB', tax:'the SIN', id:'SEGIP', banks:'BancoSol, Banco Mercantil Santa Cruz, BNB, Banco Unión', pay:'QR interbank payments', groc:'Hipermaxi, Fidalga, Ketal', food:'PedidosYa', news:'Los Tiempos, El Deber', telco:'Entel, Tigo, Viva', weather:'SENAMHI' },
  VE: { cur:'VES', tax:'the SENIAT', gov:'Patria', id:'SAIME', banks:'Banesco, Banco de Venezuela, Mercantil, BBVA Provincial', pay:'Pago Móvil', food:'Yummy', car:'the INTT', news:'El Nacional, Efecto Cocuyo, Tal Cual', telco:'Movilnet, Movistar, Digitel', weather:'INAMEH' },
  GT: { cur:'GTQ', tax:'the SAT', id:'RENAP (DPI)', banks:'Banco Industrial, Banrural, BAC, G&T Continental', jobs:'Tecoloco, Computrabajo', groc:'La Torre, Paiz, Walmart', food:'PedidosYa, Uber Eats', car:'the SAT (impuesto de circulación)', health:'the IGSS', news:'Prensa Libre', telco:'Tigo, Claro', weather:'INSIVUMEH' },
  DO: { cur:'DOP', tax:'the DGII', id:'the JCE (cédula) and the Dirección General de Pasaportes', banks:'Banreservas, Banco Popular, BHD', groc:'La Sirena, Nacional, Jumbo, Bravo', food:'PedidosYa, Uber Eats', car:'the DGII (marbete) and INTRANT', health:'your ARS', news:'Diario Libre, Listín Diario', exams:'the Pruebas Nacionales', telco:'Claro, Altice, Viva', weather:'INDOMET' },
  CR: { cur:'CRC', tax:'Hacienda (TRIBU-CR)', id:'the TSE (cédula) and Migración (passports)', banks:'BAC, Banco Nacional, Banco de Costa Rica, Davivienda', pay:'SINPE Móvil', groc:'Walmart, Auto Mercado, Más x Menos, PriceSmart', food:'Uber Eats, DiDi Food', rail:'INCOFER', car:'Riteve and the marchamo', health:'the CCSS', news:'La Nación, CRHoy, Teletica', telco:'Kölbi, Claro, Liberty', post:'Correos de Costa Rica', weather:'the IMN' },
  PA: { cur:'PAB', tax:'the DGI', id:'the Tribunal Electoral (cédula)', banks:'Banco General, Banistmo, BAC, Banco Nacional', pay:'Yappy', jobs:'Konzerta, Computrabajo', groc:'Super 99, Riba Smith, El Rey, PriceSmart', food:'PedidosYa, Uber Eats', rail:'the Panama Metro', prop:'Encuentra24', car:'the ATTT', health:'the CSS', news:'La Prensa, Panamá América, TVN', telco:'+Móvil, Tigo' },
  UY: { cur:'UYU', tax:'the DGI', gov:'gub.uy (ID Uruguay)', id:'the DNIC', banks:'BROU, Santander, Itaú, BBVA', pay:'Mercado Pago, Prex', jobs:'BuscoJobs, Gallito', shop:'Mercado Libre', groc:'Tienda Inglesa, Disco, Devoto, Ta-Ta', food:'PedidosYa, Rappi', prop:'Gallito, InfoCasas', car:'SUCIVE (patente)', health:'your mutualista or ASSE through FONASA', news:'El País, El Observador, Montevideo Portal', telco:'Antel, Movistar, Claro', post:'Correo Uruguayo', weather:'INUMET' },
  PY: { cur:'PYG', tax:'the DNIT', id:'the Policía Nacional (cédula)', banks:'Itaú, Continental, ueno', pay:'Tigo Money', groc:'Superseis, Stock, Biggie', food:'PedidosYa, Monchis', health:'the IPS', news:'ABC Color, Última Hora', telco:'Tigo, Personal, Claro' },
  RO: { cur:'RON', tax:'ANAF (SPV)', gov:'ROeID and ghiseul.ro', banks:'Banca Transilvania, BCR, BRD, ING', pay:'Revolut', jobs:'eJobs, BestJobs, OLX', shop:'eMAG, Altex, OLX', groc:'Kaufland, Lidl, Mega Image, Carrefour', food:'Glovo, Tazz, Bolt Food', rail:'CFR Călători', prop:'Imobiliare.ro, Storia', car:'the ITP inspection and the rovinietă', health:'the CNAS', news:'Digi24, HotNews, G4Media', exams:'the bacalaureat and the evaluare națională', telco:'Orange, Vodafone, Digi', post:'Poșta Română, Fan Courier, Sameday', weather:'the ANM' },
  GR: { cur:'EUR', tax:'the AADE (myAADE, TAXISnet)', gov:'gov.gr', id:'the Hellenic Police (ID cards and passports)', banks:'National Bank of Greece, Eurobank, Piraeus, Alpha Bank', pay:'IRIS', jobs:'Kariera.gr, Skywalker', shop:'Skroutz, Public, Plaisio', groc:'Sklavenitis, AB Vassilopoulos, Lidl, My market', food:'efood, Wolt, Box', rail:'Hellenic Train', prop:'Spitogatos, Xe.gr', car:'the KTEO inspection and road tax', health:'EOPYY and myHealth', news:'Kathimerini, ERT, in.gr', exams:'the Panhellenic exams', telco:'Cosmote, Vodafone, Nova', post:'ELTA, ACS, Geniki Taxydromiki', weather:'the EMY' },
  HU: { cur:'HUF', tax:'the NAV (eSZJA)', gov:'Ügyfélkapu+', id:'the government windows (Kormányablak)', banks:'OTP, K&H, Erste, MBH', pay:'instant transfers', jobs:'Profession.hu', shop:'eMAG, Alza, Árukereső', groc:'Tesco, Spar, Lidl, Aldi, Auchan', food:'Wolt, foodora', rail:'MÁV', prop:'ingatlan.com', car:'the műszaki vizsga and vehicle tax', health:'the NEAK and EESZT', news:'Telex, 444, Index', exams:'the érettségi', uni:'felvi.hu', telco:'Telekom, Yettel, One', post:'Magyar Posta, GLS', weather:'HungaroMet' },
  BG: { cur:'EUR', tax:'the NRA (NAP)', id:'the Ministry of Interior', banks:'UniCredit Bulbank, DSK, UBB, Postbank', jobs:'jobs.bg', shop:'eMAG, OLX', groc:'Kaufland, Lidl, Billa, Fantastico', food:'Glovo', rail:'BDZ', prop:'imot.bg', car:'the annual technical inspection and the vignette', health:'the NHIF', news:'Dnevnik, BNT, Mediapool', exams:'the matura', telco:'A1, Yettel, Vivacom', post:'Econt, Speedy, Bulgarian Posts', weather:'the NIMH' },
  RS: { cur:'RSD', tax:'the Tax Administration (ePorezi)', gov:'eUprava', id:'the police administration (MUP)', banks:'Banca Intesa, OTP, UniCredit, Raiffeisen, AIK', pay:'IPS instant payments', jobs:'Infostud, HelloWorld', shop:'KupujemProdajem, Gigatron', groc:'Maxi, Lidl, Idea', food:'Wolt, Glovo', rail:'Srbija Voz', prop:'4zida, Halo oglasi', car:'the technical inspection and registration', health:'the RFZO', news:'RTS, N1, Danas, Politika', exams:'the završni ispit and the matura', telco:'mts, Yettel, A1', post:'Pošta Srbije', weather:'RHMZ' },
  HR: { cur:'EUR', tax:'the Porezna uprava (ePorezna)', gov:'e-Građani', id:'the police administration (MUP)', banks:'Zagrebačka banka, PBZ, Erste, OTP', jobs:'MojPosao, Posao.hr', shop:'Njuškalo, Links', groc:'Konzum, Lidl, Spar, Plodine, Kaufland', food:'Wolt, Glovo, Bolt Food', rail:'HŽ', prop:'Njuškalo, Index oglasi', car:'the tehnički pregled', health:'the HZZO', news:'Index.hr, Jutarnji list, Večernji list, HRT', exams:'the državna matura', uni:'Postani student', telco:'Hrvatski Telekom, A1, Telemach', post:'Hrvatska pošta', weather:'the DHMZ' },
  SK: { cur:'EUR', tax:'the Financial Administration (Finančná správa)', gov:'slovensko.sk', id:'the police (ID cards and passports)', banks:'Slovenská sporiteľňa, VÚB, Tatra banka, ČSOB', jobs:'Profesia.sk', shop:'Alza, Nay', groc:'Tesco, Kaufland, Lidl, Billa', food:'Wolt, Bolt Food', rail:'ZSSK', prop:'Nehnutelnosti.sk, Reality.sk', car:'the STK and the e-vignette', health:'your health insurer (VšZP, Dôvera, Union)', news:'SME, Denník N, Aktuality.sk', exams:'the maturita', telco:'Orange, Telekom, O2, 4ka', post:'Slovenská pošta, Packeta', weather:'SHMÚ' },
  SI: { cur:'EUR', tax:'FURS (eDavki)', gov:'SI-PASS and eUprava', id:'your upravna enota', banks:'NLB, OTP banka, Addiko', pay:'Flik', jobs:'MojeDelo, Optius', shop:'Big Bang, Bolha', groc:'Mercator, Spar, Lidl, Hofer, Tuš', food:'Wolt', rail:'SŽ', prop:'Nepremičnine.net', car:'the tehnični pregled and the e-vinjeta', health:'the ZZZS', news:'RTV SLO, 24ur, Delo', exams:'the matura', telco:'Telekom Slovenije, A1, Telemach', post:'Pošta Slovenije', weather:'ARSO' },
  LT: { cur:'EUR', tax:'the VMI (Mano VMI)', gov:'epaslaugos.lt', id:'the Migration Department', banks:'Swedbank, SEB, Luminor, Šiaulių bankas', jobs:'CVBankas, CV.lt', shop:'Pigu.lt', groc:'Maxima, Iki, Rimi, Lidl', food:'Wolt, Bolt Food', rail:'LTG Link', prop:'Aruodas', car:'Regitra and the technical inspection', health:'the TLK and e.sveikata', news:'LRT, Delfi, 15min', exams:'the brandos egzaminai', uni:'LAMA BPO', telco:'Telia, Bitė, Tele2', post:'Lietuvos paštas, Omniva, DPD', weather:'the LHMT' },
  LV: { cur:'EUR', tax:'the VID (EDS)', gov:'Latvija.gov.lv', id:'the PMLP', banks:'Swedbank, SEB, Citadele, Luminor', jobs:'CV.lv', shop:'220.lv, ss.lv', groc:'Rimi, Maxima, Lidl', food:'Wolt, Bolt Food', rail:'Pasažieru vilciens', prop:'ss.lv', car:'the CSDD (technical inspection)', health:'the NVD and e-veselība', news:'LSM, Delfi, TVNET', exams:'the centralized exams', telco:'LMT, Tele2, Bite', post:'Latvijas Pasts, Omniva', weather:'LVĢMC' },
  EE: { cur:'EUR', tax:'the EMTA (e-MTA)', gov:'eesti.ee (ID-card, Mobile-ID or Smart-ID)', id:'the Police and Border Guard Board (PPA)', banks:'Swedbank, SEB, LHV, Luminor', jobs:'CV.ee, CV Keskus', shop:'Kaup24, Hansapost, Osta.ee', groc:'Rimi, Selver, Prisma, Maxima, Coop', food:'Wolt, Bolt Food', rail:'Elron', prop:'KV.ee, City24', car:'the Transport Administration (ülevaatus)', health:'the Tervisekassa and digilugu', news:'ERR, Postimees, Delfi', exams:'the riigieksamid', uni:'SAIS', telco:'Telia, Elisa, Tele2', post:'Omniva, DPD', weather:'the Estonian Environment Agency' },
};
/* The facts for one country, in one sentence the runner can read. Nothing that
   is not in the table is said, so a thin entry makes a short sentence rather
   than a confident wrong one. */
/* WHICH MAILBOX PEOPLE IN EACH COUNTRY ACTUALLY USE, MOST-USED FIRST.

   Researched, not assumed: Gmail leads in most of the world, but not in China
   (QQ Mail, NetEase 163/126), Korea (Naver), Russia (Mail.ru, Yandex) or the
   Czech Republic (Seznam), and Germany splits between WEB.DE, GMX and Gmail;
   Outlook is strong in Spain, Italy, Sweden and India. Sources: provider
   market-share surveys (clean.email, SellCell, Mailjerry, W3Techs on Naver)
   and national-provider reporting (chat-tempmail's China/Japan/Korea
   comparison). Every id here is one AMV can really connect: gmail through
   Google, outlook through Microsoft, everything else by app password (see
   MAIL_PROVIDERS). A country not listed gets the global order. */
const COUNTRY_MAIL = {
  US:['gmail','yahoo','outlook','icloud','aol'], CA:['gmail','outlook','yahoo'], MX:['gmail','outlook','yahoo'],
  GB:['gmail','outlook','yahoo','bt'], IE:['gmail','outlook'], AU:['gmail','outlook','telstra'], NZ:['gmail','outlook'],
  CN:['qq','netease163','netease126','sina'], KR:['naver','gmail','daum'], JP:['gmail','yahoojp','outlook'],
  RU:['mailru','yandex','gmail'], UA:['gmail','ukrnet'], DE:['webde','gmx','gmail','tonline','outlook'],
  AT:['gmail','gmx','outlook'], CH:['gmail','bluewin','outlook'], FR:['gmail','orange','outlook','free','laposte'],
  IT:['gmail','outlook','libero'], ES:['gmail','outlook'], PT:['gmail','outlook','sapo'], PL:['gmail','wppl','onet','interia'],
  CZ:['seznam','gmail'], NL:['gmail','outlook','kpn','ziggo'], BE:['gmail','outlook','telenet'], SE:['gmail','outlook','telia'],
  IN:['gmail','outlook','rediff'], BR:['gmail','outlook','uol'], TR:['gmail','outlook','yandextr'], IL:['gmail','outlook'], ZA:['gmail','outlook','mweb'],
  /* Kazakhstan: Yandex Mail leads business email hosting (BuiltWith, 35%),
     Mail.ru next; both serve Uzbekistan too. Consumer shares are not
     published, so Gmail stays first and the two follow it. */
  KZ:['gmail','yandex','mailru'], UZ:['gmail','mailru','yandex'],
};
const MAIL_DEFAULT_ORDER = ['gmail','outlook','yahoo'];
/* WHERE SCHOOLWORK LIVES. Google Classroom leads K-12; its largest markets are
   the US, the UK and Canada (6sense; ListEdTech 2026 K-12 LMS update), and it
   is the default in the other English-speaking systems that run on Google
   Workspace for Education. AMV reads it (school.read, on the Google
   connection). Elsewhere the national exam is the dependable thing to plan
   around, and that is what the country's school job is built on. */
const COUNTRY_CLASSROOM = ['US','GB','CA','AU','NZ','IE'];
/* WHERE A BANK COULD BE LINKED WITH A DIFFERENT PROVIDER. Said on the card
   rather than hidden, so nobody reads "not here yet" as "not possible".
   Sources: Open Banking Tracker's provider directory (Belvo and Pluggy for
   Latin America; Basiq for Australia and New Zealand; Moneytree for Japan;
   India's Account Aggregator network). */
const BANK_ELSEWHERE = { BR:'Open Finance Brasil (Belvo, Pluggy)', MX:'Belvo', CO:'Belvo', CL:'Floid', AR:'Belvo',
  IN:'the Account Aggregator network', AU:'Basiq (Consumer Data Right)', NZ:'Basiq', JP:'Moneytree', SG:'Finverse', PH:'Brankas', ID:'Brankas' };
/* WHERE PEOPLE WORK. Microsoft Teams leads workplace chat and meetings
   worldwide, with Zoom, Google and Slack (ResearchAndMarkets 2025); China runs
   on DingTalk, WeCom and Feishu instead (hiredchina, eMarketer); Japan and
   Korea add LINE WORKS and KakaoWork. */
const WORK_APPS = { CN:'DingTalk, WeCom and Feishu', JP:'LINE WORKS, Microsoft Teams and Slack', KR:'KakaoWork, Naver Works and Slack' };
const WORK_APPS_DEFAULT = 'Microsoft Teams, Slack and Google Workspace';
/* How each is connected, in the shape the page's Connect buttons already use. */
function _countryMail(code){
  const ids = (Object.prototype.hasOwnProperty.call(COUNTRY_MAIL, code) ? COUNTRY_MAIL[code] : MAIL_DEFAULT_ORDER)
    .filter(id => MAIL_PROVIDERS[id]);
  return ids.map(id => ({ id, name: String(MAIL_PROVIDERS[id].name).replace(/\s*\(.*$/, '').replace(/\s*\/.*$/, ''),
    how: id === 'gmail' ? 'g' : id === 'outlook' ? 'ms' : 'mail:' + id }));
}
const FACT_LABELS = { cur:'currency', tax:'tax authority', gov:'government sign-in', id:'ID and passports', banks:'main banks', pay:'everyday payments', jobs:'job sites', shop:'where people shop online', groc:'supermarkets', food:'food delivery', rail:'trains', prop:'property sites', car:'vehicle admin', health:'health system', news:'news', exams:'school and entrance exams', uni:'university applications', telco:'mobile networks', post:'post and parcels', weather:'weather service' };
function _jobCountry(asked, request){
  const ok = c => /^[A-Z]{2}$/.test(c) && Object.prototype.hasOwnProperty.call(COUNTRY_NAME, c) ? c : '';
  return ok(String(asked || '').trim().toUpperCase())
      || ok(String((request && request.cf && request.cf.country) || '').toUpperCase());
}
function _countryRunNote(cc){
  if(!cc || !Object.prototype.hasOwnProperty.call(COUNTRY_NAME, cc)) return '';
  const line = _countryFactsLine(cc);
  return '\n\nWHERE THEY ARE: ' + COUNTRY_NAME[cc] + '. Answer for ' + COUNTRY_NAME[cc]
    + ' - its prices, currency, sites, services, rules and language of everyday life - unless the job itself names somewhere else.'
    + (line ? '\nUseful local starting points (' + line + ').' : '')
    + '\nCheck any deadline, fee, amount, eligibility rule or legal requirement against the official source for '
    + COUNTRY_NAME[cc] + ' before stating it, and name that source.';
}
function _countryFactsLine(cc){
