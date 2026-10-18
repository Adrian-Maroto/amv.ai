/* ══════════════════════════════════════════════════════════════
   MARKETPLACE TRUST & SAFETY
   Multi-layer automated review that runs server-side on every publish, so it
   cannot be bypassed by modifying the client.

   Layer 1  Normalization  - defeats evasion (leetspeak, spacing, homoglyphs)
   Layer 2  Prohibited categories - hard block, listing never goes live
   Layer 3  Regulated categories  - hard block unless verified seller
   Layer 4  Risk signals - listing published but held for human review
   Layer 5  Seller strikes - repeat offenders lose selling access
   ══════════════════════════════════════════════════════════════ */

/* Layer 1 - normalize text so "c0ca1ne", "c o c a i n e", "ⅽocaine" all match. */
function _mktNormalize(str) {
  let t = String(str || '').toLowerCase();
  // strip zero-width / invisible characters used to break up words
  t = t.replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e\u061c]/g, '');
  // map common homoglyphs (Cyrillic/Greek look-alikes) back to Latin
  const homo = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','ѕ':'s','і':'i','ј':'j','к':'k','м':'m','н':'h','т':'t','в':'b','г':'r','ԁ':'d','ո':'n','ε':'e','ο':'o','ρ':'p','τ':'t','ν':'v','α':'a','ι':'i','κ':'k','μ':'m' };
  t = t.replace(/[а-яөԁα-ωѕіј]/g, c => homo[c] || c);
  // strip accents / homoglyph forms
  try { t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  // common leetspeak substitutions
  const leet = { '0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','5':'s','$':'s','7':'t','8':'b','9':'g','+':'t','|':'i' };
  t = t.replace(/[01!34@5$789+|]/g, c => leet[c] || c);
  // collapse separators used to break up words: c-o-c-a-i-n-e, c.o.c.a.i.n.e
  t = t.replace(/[\s._\-*~`'"()\[\]{}<>\/\\]+/g, ' ');
  return { spaced: ' ' + t.replace(/\s+/g, ' ').trim() + ' ', squeezed: t.replace(/\s+/g, '') };
}

/* Layer 2 - PROHIBITED. Nothing in these categories may ever be listed. */
const MKT_PROHIBITED = {
  'Illegal drugs & controlled substances': [
    'cocaine','heroin','fentanyl','methamphetamine','crystal meth','mdma','ecstasy','lsd','ketamine','pcp','crack cocaine',
    'psilocybin','magic mushrooms','ghb','rohypnol','roofie','oxycontin','oxycodone','percocet','xanax','xanax bars','adderall',
    'vicodin','codeine','lean drug','promethazine','tramadol','valium','klonopin','opioid','opiates',
    'illegal drugs','buy drugs','sell drugs','drug dealer','narcotics for sale','dark web drugs','research chemicals',
    'anabolic steroids','hgh for sale','prescription without','no prescription needed',
    'weed for sale','buy weed','sell weed','marijuana for sale','buy marijuana','cannabis for sale','buy cannabis',
    'thc cart','dab pen','edibles for sale','ounce of weed','gram of weed','8 ball','eightball','molly for sale','buy molly',
    'shrooms for sale','acid tabs','dmt','coke for sale','plug drugs','drug plug','420 friendly bud','top shelf bud',
    'sativa for sale','indica for sale',
  ],
  'Weapons & explosives': [
    'firearm','handgun','rifle for sale','assault weapon','ghost gun','untraceable gun','80 lower','auto sear','glock switch',
    'silencer','suppressor','ammunition','ammo for sale','high capacity magazine','bump stock',
    'explosive','pipe bomb','bomb making','ied','grenade','detonator','napalm','thermite','tannerite',
    'weapon blueprint','3d printed gun','gun cad','firearm files','poison','ricin','nerve agent','sarin','chemical weapon',
  ],
  'Malware, hacking & cyber attack': [
    'malware','ransomware','keylogger','botnet','ddos','rootkit','trojan','spyware','stalkerware','worm virus',
    'exploit kit','zero day exploit','0day exploit','remote access trojan','rat builder','crypter','stealer',
    'phishing kit','phishing page','phishing template','scam page','fake login page','clone site',
    'sql injection tool','brute force tool','password cracker','credential stuffing','account cracker','combo list',
    'sim swap','swatting','doxxing service','ip grabber','hack someone','hacking service','hack account',
  ],
  'Stolen data & credentials': [
    'stolen data','stolen account','hacked account','cracked account','database dump','leaked database','data breach dump',
    'stolen card','stolen credit','credit card numbers','card dump','cvv dump','fullz','bank logs','bank drop',
    'dumps with pin','carding','carder','paypal log','netflix account cheap','spotify account cheap','account list',
    'ssn list','social security numbers','identity package','scan of passport','stolen identity',
  ],
  'Fraud, scams & counterfeiting': [
    'money launder','launder money','money mule','cash out method','cashout method','fraud method','fraud bible',
    'counterfeit','fake id','forged document','fake passport','fake diploma','fake certificate','replica designer',
    'ponzi','pyramid scheme','get rich quick guaranteed','guaranteed profit','risk free profit','insider trading',
    'chargeback fraud','refund method','refund glitch','triangulation fraud','bin method','sniffed',
  ],
  'Sexual content & exploitation': [
    'child porn','csam','cp for sale','underage','minor sexual','loli','shota','jailbait','preteen nude',
    'bestiality','rape porn','non consensual','revenge porn','upskirt','hidden camera nude','deepfake nude','nudify',
    'escort service','prostitution','sex trafficking','onlyfans leak','nude leak',
  ],
  'Violence, terrorism & trafficking': [
    'assassinate','murder for hire','hitman','contract killing','kill someone','how to kill','how to murder',
    'human trafficking','organ sale','sell organ','kidnapping guide','torture',
    'terrorist','terrorism','isis','al qaeda','extremist manifesto','mass shooting plan','school shooting',
    'genocide','ethnic cleansing',
  ],
  'Hate & harassment': [
    'white supremacy','neo nazi','race war','holocaust denial','ethnic slur pack','hate speech pack',
    'harassment campaign','brigading service','swat someone',
  ],
  'Piracy & IP theft': [
    'pirated','cracked software','keygen','license key generator','nulled script','warez','torrent dump',
    'stolen course','leaked course','ripped content','bypass drm','drm removal',
  ],
  'Self-harm': [
    'suicide method','how to kill yourself','best way to die','suicide kit','pro ana','thinspo','self harm guide',
  ],
};

/* Layer 3 - REGULATED. Blocked unless the seller is verified for that category.
   (Verification is an operator action; unverified sellers simply can't list these.) */
const MKT_REGULATED = {
  'Financial & investment advice': ['investment advice','financial advice','stock picks','trading signals','forex signals','crypto signals','guaranteed returns','portfolio management'],
  'Medical & health claims': ['medical advice','cure cancer','miracle cure','diagnose','prescription','treatment plan','weight loss guaranteed'],
  'Legal advice': ['legal advice','legal representation','sue someone','lawsuit template guaranteed'],
  'Adult (18+)': ['adult content','nsfw','erotica','porn'],
};

/* Layer 4 - RISK SIGNALS. Not blocked, but the listing is held for review. */
const MKT_RISK_SIGNALS = [
  'hack','exploit','crack','bypass','scrape','scraper','bot farm','automation bot','mass dm','spam',
  'password','credential','proxy list','vpn crack','account generator','otp bypass','2fa bypass',
  'crypto','forex','trading bot','arbitrage','airdrop','presale','pump','nft flip',
  'guaranteed','get rich','passive income guaranteed','make money fast','mlm','downline','recruit',
  'unlimited','unlocked','premium free','free trial abuse',
];

/* Screen a listing. Returns a decision object. */
function _marketScreen(item, sellerVerifiedFor) {
  const fields = [item.title, item.desc, item.cat, item.text,
    Array.isArray(item.files) ? item.files.map(f => f && f.name).join(' ') : ''];
  const raw = fields.map(x => String(x || '')).join(' ');
  const n = _mktNormalize(raw);

  const hit = (term) => {
    const t = _mktNormalize(term);
    // word-ish boundary on the spaced form, plus a squeezed-form containment check
    const esc = t.spaced.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^| )' + esc + '( |$)', 'i').test(n.spaced)) return true;
    if (t.squeezed.length >= 6 && n.squeezed.includes(t.squeezed)) return true;
    return false;
  };

  // Layer 2 - prohibited
  for (const [category, terms] of Object.entries(MKT_PROHIBITED)) {
    for (const term of terms) {
      if (hit(term)) {
        return { ok: false, action: 'blocked', category, term,
          reason: 'This listing appears to involve prohibited content (' + category + '). It cannot be published. Selling this violates the Marketplace Terms and may result in losing selling access.' };
      }
    }
  }
  // Layer 3 - regulated
  for (const [category, terms] of Object.entries(MKT_REGULATED)) {
    for (const term of terms) {
      if (hit(term)) {
        const verified = Array.isArray(sellerVerifiedFor) && sellerVerifiedFor.includes(category);
        if (!verified) {
          return { ok: false, action: 'needs_verification', category, term,
            reason: category + ' listings require a verified seller account. Apply for verification to list in this category.' };
        }
      }
    }
  }
  // Layer 4 - risk signals
  const signals = [];
  for (const term of MKT_RISK_SIGNALS) { if (hit(term)) signals.push(term); }
  if (signals.length) {
    return { ok: true, action: 'held_for_review', signals: signals.slice(0, 5),
      reason: 'Your listing is live but flagged for review. If it complies with the rules it stays up; if not, it will be removed.' };
  }
  return { ok: true, action: 'approved' };
}

/* http(s) only, and short. Anything else - javascript:, data:, vbscript: - is
   dropped rather than stored. */
function _safeHttpUrl(u) {
  const raw = String(u == null ? '' : u).trim().slice(0, 500);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString().slice(0, 500);
  } catch (e) { return undefined; }
}

/* A PLUGIN LISTING: skills, prompts and app names. Text only, bounded, the
   same rules the page applies (_plNormalize in src/skills/skills.js) -
   checked here because a request does not have to come from the page. Too
   long is refused rather than cut: a cut instruction is not the one the
   seller wrote, and not the one the buyer was shown.

   Returns { plugin, text } - `text` is every word it carries, so the content
   screen and the AMV-only rule read the instructions buyers actually get, not
   just the listing's description. */
const MKT_PLUGIN = { skills: 10, prompts: 20, apps: 8, jobs: 5, jobText: 1000, text: 4000 };
const MKT_PLUGIN_REPEATS = ['daily', 'weekly', 'monthly'];
const MKT_PLUGIN_APP_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&+'’-]{0,39}$/u;
function _mktPluginClean(p){
  const no = (error) => ({ error });
  if(!p || typeof p !== 'object') return no('A plugin listing needs its plugin - at least one skill or prompt.');
  const str = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
  const rs = Array.isArray(p.skills) ? p.skills : [], rp = Array.isArray(p.prompts) ? p.prompts : [], ra = Array.isArray(p.apps) ? p.apps : [];
  if(rs.length > MKT_PLUGIN.skills || rp.length > MKT_PLUGIN.prompts || ra.length > MKT_PLUGIN.apps)
    return no(`A plugin carries at most ${MKT_PLUGIN.skills} skills, ${MKT_PLUGIN.prompts} prompts and ${MKT_PLUGIN.apps} apps.`);
  const skills = [], prompts = [], apps = [];
  for(const s of rs){
    if(!s || typeof s.name !== 'string' || typeof s.instr !== 'string' || !s.name.trim() || !s.instr.trim()) return no('Every skill in a plugin needs a name and instructions.');
    if(s.instr.length > MKT_PLUGIN.text) return no(`A skill's instructions are limited to ${MKT_PLUGIN.text} characters.`);
    const mode = s.mode === 'auto' ? 'auto' : 'always', when = str(s.when, 200);
    if(mode === 'auto' && !when) return no('A skill used only when relevant has to say what it is for.');
    skills.push({ name: str(s.name, 60), when, instr: str(s.instr, MKT_PLUGIN.text), mode });
  }
  for(const x of rp){
    if(!x || typeof x.title !== 'string' || typeof x.text !== 'string' || !x.title.trim() || !x.text.trim()) return no('Every prompt in a plugin needs a title and text.');
    if(x.text.length > MKT_PLUGIN.text) return no(`A prompt is limited to ${MKT_PLUGIN.text} characters.`);
    prompts.push({ title: str(x.title, 100), text: str(x.text, MKT_PLUGIN.text) });
  }
  for(const a of ra){
    const n = str(a, 40);
    if(!MKT_PLUGIN_APP_RE.test(n)) return no('An app a plugin works with is named in plain words, nothing else.');
    if(apps.indexOf(n) < 0) apps.push(n);
  }
  /* Jobs a buyer can set up. Text and a schedule, nothing that runs: the
     buyer's own press creates the job, through the same route as any other. */
  const rj = Array.isArray(p.jobs) ? p.jobs : [];
  if(rj.length > MKT_PLUGIN.jobs) return no(`A plugin carries at most ${MKT_PLUGIN.jobs} background jobs.`);
  const jobs = [];
  for(const j of rj){
    if(!j || typeof j.title !== 'string' || typeof j.detail !== 'string' || !j.title.trim() || !j.detail.trim()) return no('Every background job in a plugin needs a title and what it does.');
    if(j.detail.length > MKT_PLUGIN.jobText) return no(`A background job is limited to ${MKT_PLUGIN.jobText} characters.`);
    if(!MKT_PLUGIN_REPEATS.includes(j.repeat)) return no('A background job in a plugin runs daily, weekly or monthly.');
    const time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(j.time || '').trim()) ? String(j.time).trim() : '';
    const days = (Array.isArray(j.days) ? j.days : []).map(d => String(d).slice(0, 3).toLowerCase())
      .filter(d => ['sun','mon','tue','wed','thu','fri','sat'].includes(d)).slice(0, 7);
    jobs.push({ title: str(j.title, 80), detail: str(j.detail, MKT_PLUGIN.jobText), repeat: j.repeat, time, days });
  }
  if(!skills.length && !prompts.length && !jobs.length) return no('A plugin listing needs its plugin - at least one skill, prompt or job.');
  const text = skills.map(s => s.name + ' ' + s.when + ' ' + s.instr).concat(prompts.map(x => x.title + ' ' + x.text), jobs.map(j => j.title + ' ' + j.detail), apps).join(' ');
  return { plugin: { skills, prompts, apps, jobs }, text };
}

async function marketPublish(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to publish' }, 401);
  // Guard against listing spam - a handful a minute, a sane cap per day.
  const blocked = await guardAction(env, `mktpub:${user.email}`, 5, 50, 'listings');
  if (blocked) return blocked;
  const item = await request.json().catch(() => ({}));
  const title = String(item.title || '').slice(0, 100).trim();
  if (!title) return json({ error: 'title required' }, 400);

  // ── Trust & Safety: seller standing ──────────────────────────
  const standing = (await DB.get(env, 'seller', user.email)) || { strikes: 0, banned: false, verifiedFor: [] };
  if (standing.banned) {
    return json({ error: 'Your selling access has been suspended for repeated policy violations. Contact support to appeal.', code: 'seller_suspended' }, 403);
  }

  /* A plugin is checked whole before anything is screened, and its text is
     screened with the listing - its instructions are what buyers get. */
  let pluginClean = null;
  if (item.kind === 'plugin') {
    pluginClean = _mktPluginClean(item.plugin);
    if (pluginClean.error) return json({ error: pluginClean.error, code: 'bad_plugin' }, 400);
  }

  // ── Automated content review (server-side = cannot be bypassed) ──
  const screen = _marketScreen(pluginClean ? { ...item, text: String(item.text || '') + ' ' + pluginClean.text } : item, standing.verifiedFor);
  if (!screen.ok) {
    if (screen.action === 'blocked') {
      /* Under the lock: moderation writes this record too, and a strike lost
         to a concurrent write is a seller who should be suspended and is not.
         Counted INSIDE, from the stored value rather than from the copy read
         at the top of this handler, so two violations landing together both
         count instead of the second overwriting the first with the same
         number. What the reply says comes back out of the lock, so the person
         is told the strike they actually have. */
      const after = await _withKind(env, 'seller', user.email, (fresh) => {
        if(!fresh) return null;
        fresh.strikes = (fresh.strikes || 0) + 1;
        fresh.lastViolation = { category: screen.category, at: Date.now() };
        if(fresh.strikes >= 3) fresh.banned = true;      // 3 strikes = suspended
        return { strikes: fresh.strikes, banned: !!fresh.banned };
      }, { strikes: 0, banned: false, verifiedFor: [] });
      standing.strikes = (after && after.strikes) || ((standing.strikes || 0) + 1);
      standing.banned = !!(after && after.banned);
      audit(env, 'market_blocked', { by: user.email, title, category: screen.category, term: screen.term, strikes: standing.strikes });
      return json({
        error: screen.reason, code: 'policy_violation', category: screen.category,
        strikes: standing.strikes, suspended: !!standing.banned,
      }, 422);
    }
    // needs verification
    audit(env, 'market_needs_verification', { by: user.email, title, category: screen.category });
    return json({ error: screen.reason, code: 'needs_verification', category: screen.category }, 422);
  }
  const kind = ['prompt', 'crew', 'agent', 'plugin', 'integration', 'workflow', 'guide', 'bundle'].includes(item.kind) ? item.kind : 'prompt';
  // price: 0 = free; otherwise whole dollars, $1..$999
  let price = Math.round(Number(item.price) || 0);
  if (price < 0) price = 0;
  if (price > 999) price = 999;
  const body = String(item.text || '').slice(0, 20000);
  // AMV-only content guard: reject listings that reference other AI brands.
  const blob = (title + ' ' + (item.desc || '') + ' ' + body + ' ' + (pluginClean ? pluginClean.text : '')).toLowerCase();
  const banned = ['claude', 'anthropic', 'openai', 'chatgpt', 'gpt-4', 'gpt-5', 'gemini', 'copilot', 'grok', 'llama', 'mistral', 'perplexity'];
  const hit = banned.find(b => blob.includes(b));
  if (hit) return json({ error: 'Listings must be AMV-only - remove references to other AI products (' + hit + ').' }, 400);
  // File attachments: store metadata + data. NOTE: KV caps values at 25MB - for
  // large media, production should upload to R2 and store only the URL here.
  // AMV-028: bound inline file payloads by DECODED byte size (not just string
  // length), per-file and in aggregate, so a listing can't smuggle a huge blob or
  // a decompression bomb into the record (which would amplify every read, write,
  // backup and response). Larger deliverables must be hosted and linked by URL.
  const MAX_FILE_B64 = 700 * 1024;             // ~512 KB decoded per file
  const MAX_FILES_B64_TOTAL = 3 * 1024 * 1024; // ~2.2 MB decoded across all files
  const rawFiles = Array.isArray(item.files) ? item.files.slice(0, 20) : [];
  let filesTotal = 0;
  for (const f of rawFiles) {
    const dlen = (f && typeof f.data === 'string') ? f.data.length : 0;
    if (dlen > MAX_FILE_B64) return json({ error: 'a file is too large to attach inline - host it and share a download link instead' }, 413);
    filesTotal += dlen;
  }
  if (filesTotal > MAX_FILES_B64_TOTAL) return json({ error: 'the attached files are too large in total - keep them under ~2MB or link them' }, 413);
  /* AFTER the request has been checked, and for the same reason the checkout
     gate sits after the configuration checks: do not ask somebody a personal
     question in order to process a request that was going to be refused
     anyway. A listing with a 3MB file attached is a 413 whatever the seller's
     age is, and "confirm your age" followed by "that file is too big" is two
     steps where one would do - the second of them avoidable.

     The content screen runs BEFORE this, and I considered moving the gate above
     it so a seller who has not passed the age check cannot collect a strike.
     It cannot be both: the screen sits above the file-size checks, so anything
     before the screen is also before the 413 this ordering exists to protect.
     Leaving it here is the better trade - a strike is recorded for submitting
     prohibited content, which is a thing somebody did regardless of how old
     they are, and the size refusal is the one a real person hits by accident.

     Publishing is gated at all for a different reason than buying: a listing
     creates a PAYOUT relationship - AMV ends up owing this person money - and
     that is a contract a minor cannot form either. Same question-then-retry
     shape as the rest: 428 means nobody ever asked, 403 is the actual no. */
  {
    const ageBad = await _moneyAgeGate(env, user.email);
    if (ageBad) return json(ageBad, ageBad.code === 'age_required' ? 428 : 403);
  }
  let files = rawFiles.map(f => ({
    name: String(f.name || 'file').slice(0, 160),
    type: String(f.type || 'application/octet-stream').slice(0, 100),
    size: Math.max(0, Number(f.size) || 0),
    data: typeof f.data === 'string' ? f.data : '',
    /* AMV-096: scheme-checked at the door. Nothing renders this as a link
       today, so it is not a live hole - but storing an attacker-chosen URL and
       trusting a future renderer not to make it an href is how stored XSS gets
       introduced by an unrelated change months later. Validate where it enters,
       not where it is used. */
    url: _safeHttpUrl(f.url),
  }));
  if (!body && !files.length && !(Array.isArray(item.crew) && item.crew.length) && !pluginClean) {
    return json({ error: 'add a deliverable: text, a crew, or at least one file' }, 400);
  }
  /* An assistant is its instructions: without them there is nothing to install. */
  if (kind === 'agent' && body.split(/\s+/).filter(Boolean).length < 8) {
    return json({ error: 'An assistant must include its instructions - what it is for and how it answers, at least a couple of sentences.', code: 'empty_assistant' }, 400);
  }
  /* What makes it an assistant beyond its text: starter questions and an
     engine. Bounded and plain - starters are shown as text, and the engine is
     only ever a name the buyer's own plan is checked against. */
  const assistant = kind === 'agent' && item.assistant && typeof item.assistant === 'object' ? {
    starters: (Array.isArray(item.assistant.starters) ? item.assistant.starters : []).slice(0, 4)
      .map(x => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140)).filter(Boolean),
    engine: /^[a-z][a-z0-9-]{0,31}$/.test(String(item.assistant.engine || '')) ? String(item.assistant.engine) : '',
  } : undefined;
  const clean = {
    id: 'usr_' + crypto.randomUUID().replace(/-/g,''),
    kind, title,
    cat: String(item.cat || 'Community').slice(0, 40),
    desc: String(item.desc || '').slice(0, 280),
    text: body,
    crew: Array.isArray(item.crew) ? item.crew.slice(0, 8) : undefined,
    assistant,
    plugin: pluginClean ? pluginClean.plugin : undefined,
    files,
    // icon is rendered unescaped on the client, so store an emoji/short-text
    // only - reject any markup outright (never a truncated tag fragment).
    icon: (function(ic){ ic = String(ic == null ? '\u2728' : ic); return ic.indexOf('<') >= 0 ? '\u2728' : (ic.slice(0, 8) || '\u2728'); })(),
    price,
    author: (user.name || user.email.split('@')[0]).slice(0, 40),
    authorEmail: user.email,
    installs: 0,
    sales: 0,
    views: 0,
    status: screen.action === 'held_for_review' ? 'under_review' : 'active',
    review: screen.action === 'held_for_review' ? { signals: screen.signals || [], at: Date.now() } : undefined,
    createdAt: Date.now(),
  };
  await env.AMV_KV.put(`market:${clean.id}`, JSON.stringify(clean));
  await _sellerIndexAdd(env, user.email, clean.id);
  await _marketCacheBust(env);
  if (screen.action === 'held_for_review') {
    audit(env, 'market_held_for_review', { id: clean.id, by: user.email, signals: screen.signals });
  }
  audit(env, 'market_publish', { id: clean.id, by: user.email, price, files: files.length, status: clean.status });
  return json({ ok: true, item: _publicListing(clean), review: screen.action === 'held_for_review' ? screen.reason : undefined });
}

/* Strip the deliverable (text/crew/file DATA) from a paid listing so it can't
   be read for free from the public catalog. File NAMES stay as a teaser.
   Free items keep their content inline. */
function _publicListing(it) {
  if (!it.price || it.price <= 0) return it;
  const { text, crew, files, plugin, ...rest } = it;
  const teaser = Array.isArray(files) ? files.map(f => ({ name: f.name, type: f.type, size: f.size })) : [];
  return { ...rest, files: teaser, locked: true };
}

async function marketInstall(request, env) {
  /* AMV-096: installs drive ranking, so an install has to cost something. It
     used to be unauthenticated and limited only per IP, which means a rented
     address pool could rank anything to the top of the marketplace. Now it
     takes an account, and counts ONCE per account per listing - a number that
     can be manufactured is not a ranking signal, it is an advertisement. */
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in to install' }, 401);
  const iip = _rlIp(request);
  const irl = await limitAction(env, `mktinstall:${iip}`, 30, 300);
  if (!irl.ok) return json({ ok: true, throttled: true });
  const { id } = await request.json().catch(() => ({}));
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return json({ error: 'bad id' }, 400);
  // Second and later installs by the same account are honoured, but not counted.
  const first = await _claimOnce(env, 'mktinst', `${user.email}:${id}`, CLAIM_ONCE_TTL_S);
  if (!first) return json({ ok: true, counted: false });
  const raw = await env.AMV_KV.get(`market:${id}`);
  if (raw) {
    try {
      JSON.parse(raw);                       // still a listing, not a stray key
      await _withKV(env, 'market', id, (rec) => {
        if (rec) rec.installs = (rec.installs || 0) + 1;
      });
    } catch {}
  }
  return json({ ok: true, counted: true });
}

