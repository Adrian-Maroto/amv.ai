/*
 * AMV build - assembles the single-file index.html from app.js + styles.css.
 *
 *   node build.mjs          # rebuild index.html
 *   node build.mjs check    # syntax-check app.js and the assembled JS only
 *
 * Performance: the main script is injected between the BUILD:JS markers as a
 * NON-render-blocking deferred script. The JS body is placed in a
 * <script type="text/plain"> (the browser does NOT parse/execute inert text),
 * then a tiny bootstrap turns it into a deferred Blob-URL <script>. This lets
 * the static landing HTML + CSS paint immediately (fast first paint) while the
 * ~790KB app parses in the background - without breaking the single-file app
 * (still one index.html, no external requests, global scope + strict mode
 * preserved, DOM fully available when the code runs).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { deflateSync as zlibDeflate } from 'zlib';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';
import vm from 'vm';

const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith('--')) || 'build';
/* Minified by DEFAULT. index.html is the artifact users download - 2.3MB
   plain, 1.8MB minified, 690KB vs 516KB over the wire - and app.js is written
   unminified beside it either way, which is what check, preflight and grep
   read. So the readable copy is kept where it is actually used, and the copy
   that crosses the network is the small one. --no-minify opts out. */
const MINIFY = !args.includes('--no-minify');

// The app SOURCE is modular: src/app/NN-name.js files, concatenated in name
// order, form the single app bundle. app.js is the GENERATED concatenation of
// those modules - it stays committed so check.mjs / preflight / grep keep
// working unchanged. IMPORTANT: do NOT hand-edit app.js; edit the src/app/
// modules and rebuild (the build overwrites app.js from them).
const APP_SRC_DIR = 'src/app';

/* THE BRIDGE IS SERVED BESIDE THE PAGE, NOT INSIDE IT.

   The daemon that lets AMV work on somebody's own computer is a file in this
   repository, which is a fine answer for anybody who has the repository and
   no answer at all for somebody who has only ever used the website. The
   connect card used to tell them to run `npx amv-bridge`, a package nobody
   has published, so it failed for exactly the people it was written for.

   The first attempt at fixing that embedded the file in the bundle as
   base64, and the page-weight ceiling caught it: 10KB gzipped, and 7KB even
   after compressing first. That is a tax on every visitor for a file only
   developers will ever download, which is the wrong trade however small the
   number is - the ceiling exists to ask exactly that question and the honest
   answer was no.

   So it is written out beside index.html, the way sw.js and the manifest
   already are, and fetched when somebody asks for it. Zero bytes on the
   page, the same origin and the same connection as AMV itself - which for a
   program about to run shell commands on somebody's machine is better
   provenance than a package registry, not worse. A suite checks the served
   copy is byte-identical to the file the bridge tests drive, because a
   shipped copy that has drifted from the tested one is worse than no copy. */
const BRIDGE_SRC = 'bridge/amv-bridge.mjs';
const BRIDGE_OUT = 'amv-bridge.mjs';
function emitBridge() {
  writeFileSync(BRIDGE_OUT, readFileSync(BRIDGE_SRC));
  emitSandbox();
}
/* THE CODE SANDBOX is its own page (src/sandbox/): the app frames it with
   sandbox="allow-scripts", which gives it an opaque origin and its own policy.
   Emitted beside index.html like the bridge and the worker, byte-identical, and
   published - the app's browser asks for both files. */
function emitSandbox() {
  writeFileSync('sandbox.html', readFileSync('src/sandbox/sandbox.html'));
  writeFileSync('sandbox.js', readFileSync('src/sandbox/sandbox.js'));
}

function assembleJS() {
  const files = readdirSync(APP_SRC_DIR).filter(f => /\.js$/.test(f)).sort();
  if (!files.length) throw new Error(`no source modules found in ${APP_SRC_DIR}/`);
  const full = files.map(f => readFileSync(`${APP_SRC_DIR}/${f}`, 'utf8')).join('');
  emitBridge();
  const { shipped, packs } = splitI18n(full);
  writeI18nPacks(packs);
  writeFileSync('app.js', shipped);   // regenerate the committed bundle - exactly what ships, unminified
  return shipped;
}

/* THE TRANSLATIONS SHIP ONE LANGUAGE AT A TIME.

   The dictionary is written in src/app/04-i18n.js, between BUILD:I18N-DATA
   markers, and used to ship inline: every visitor downloaded every label in
   nineteen languages - about a tenth of the page - to read it in one. Here it
   is taken out of the bundle and written as one file per language, and the
   page fetches the one it needs (see _i18nLoadPack).

   MERGED LANGUAGE BY LANGUAGE, which it never was. The data comes from three
   places: a hand-written object literal, and two generated dictionaries folded
   in at load. In the page, a key written twice in the literal kept only the
   SECOND entry - an object literal does not merge - and one generated
   dictionary only filled keys the literal lacked entirely. So "Settings",
   written once for Spanish/Chinese/Hindi and again for Bengali/Urdu/Korean,
   had no Spanish at all. Here every source contributes every language it has,
   and the precedence is the one the comments always claimed: hand-written
   first, then the generated ones. */
const I18N_START = '/* BUILD:I18N-DATA:START';
const I18N_END = '/* BUILD:I18N-DATA:END */';
function splitI18n(full) {
  const a = full.indexOf(I18N_START), b = full.indexOf(I18N_END);
  if (a < 0 || b < 0 || b < a) {
    throw new Error('i18n data markers not found in src/app - refusing to build a page whose translations went nowhere');
  }
  const dict = mergeI18n(full.slice(a, b));
  const packs = {};
  for (const k of Object.keys(dict).sort()) {
    for (const c of Object.keys(dict[k]).sort()) (packs[c] || (packs[c] = {}))[k] = dict[k][c];
  }
  if (Object.keys(packs).length < 5) throw new Error('i18n: only ' + Object.keys(packs).length + ' languages came out of the dictionary - the merge is broken, not the data');
  const shipped = full.slice(0, a)
    + '/* Translations are not inline: the build writes i18n/<code>.json (build.mjs, splitI18n). */\n'
    + 'const I18N = {};\n'
    + full.slice(b + I18N_END.length);
  return { shipped, packs };
}
function mergeI18n(region) {
  /* 1. The hand-written literal, one entry per line, so a key written twice
        merges instead of the later entry erasing the earlier one. */
  const OPEN = 'const I18N = {';
  const li = region.indexOf(OPEN), le = region.indexOf('\n};', li);
  if (li < 0 || le < 0) throw new Error('i18n: the hand-written dictionary literal was not found');
  const hand = {};
  for (const line of region.slice(li + OPEN.length, le).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    let obj;
    try { obj = vm.runInNewContext('({' + t.replace(/,\s*$/, '') + '})'); }
    catch (e) { throw new Error('i18n: a dictionary line could not be read - every entry must be on one line: ' + t.slice(0, 80)); }
    for (const k in obj) hand[k] = Object.assign(hand[k] || {}, obj[k]);
  }
  /* 2. The two generated dictionaries, run exactly as they run in the page. */
  const sandbox = { window: {} };
  vm.runInNewContext('var I18N = {};' + region.slice(le + 3), sandbox);
  const folded = sandbox.I18N || {}, gen = sandbox.window.__AMV_I18N_DICT__ || {};
  /* 3. Language by language: generated, then folded, then hand-written, each
        overriding the one before - so hand-written wins where it has a value. */
  const out = {};
  for (const k of new Set([...Object.keys(gen), ...Object.keys(folded), ...Object.keys(hand)])) {
    const e = {};
    for (const from of [gen[k], folded[k], hand[k]]) if (from) for (const c in from) if (from[c]) e[c] = String(from[c]);
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}
const I18N_DIR = 'i18n';
let I18N_FILES = [];
function writeI18nPacks(packs) {
  if (!existsSync(I18N_DIR)) mkdirSync(I18N_DIR, { recursive: true });
  I18N_FILES = Object.keys(packs).sort().map(c => I18N_DIR + '/' + c + '.json');
  for (const c of Object.keys(packs)) writeFileSync(I18N_DIR + '/' + c + '.json', JSON.stringify(packs[c]) + '\n');
  /* A language that stopped existing must stop being served. */
  for (const f of readdirSync(I18N_DIR)) {
    if (!I18N_FILES.includes(I18N_DIR + '/' + f)) { unlinkSync(I18N_DIR + '/' + f); console.warn('  - removed ' + I18N_DIR + '/' + f); }
  }
}

/* THE STYLESHEET WENT OUT WITH ITS COMMENTS ON.

   The JS is minified before it is injected - terser, and app.js stays
   readable on disk beside it. styles.css was injected verbatim, so every
   visitor downloaded 145KB of explanatory prose that only a developer ever
   reads. Gzipped that is 60KB, about a tenth of the entire page, on every
   first load, on every device.

   This is the same trade the JS already makes and for the same reason: the
   file on disk stays exactly as written, because that is the copy people
   edit and grep; the copy that crosses the network does not need the essays.

   WRITTEN AS A SCANNER, NOT A REGEX. A stylesheet full of prose contains a
   great many apostrophes, and `/\*[\s\S]*?\*\//g` cannot tell a comment from
   a quote inside one - the same unsoundness that ate a real call the last
   time a string-stripper was written by pattern (LESSONS 308). So this walks
   the file once, tracking whether it is inside a comment or a string, and
   only a real comment is dropped. A `/*` inside a `content:` string is left
   exactly where it is. */
function stripCssComments(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;                 // unterminated: drop the rest
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === quote) { j++; break; }
        if (css[j] === '\n') break;              // CSS strings do not span lines
        j++;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  /* Left-over blank lines and indentation, which is most of what a stripped
     file is. Line structure is not preserved: nothing reads this copy. */
  return out.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n').trim();
}

// Optionally minify with terser. Kept opt-in (--minify) so the default build
// stays readable/debuggable; a production build can ship the smaller bundle.
// The minified code is always syntax-validated before use, and the build
// refuses to ship if terser errors.
async function minifyJS(code) {
  const { minify } = await import('terser');
  const result = await minify(code, {
    ecma: 2020,
    compress: { passes: 2, drop_debugger: true },
    mangle: { keep_fnames: false },
    format: { comments: false },
    // Keep top-level names reachable: the app relies on many globals being
    // referenced by name across the single script (and from the deferred blob).
    toplevel: false,
  });
  if (result.error) throw result.error;
  if (!result.code) throw new Error('terser produced no output');
  return result.code;
}

function validate(js) {
  writeFileSync('/tmp/_amv_check.js', js);
  execSync('node --check /tmp/_amv_check.js', { stdio: 'pipe' });
}

/* AN EDIT MADE IN THE WRONG HALF OF index.html.

   Most of index.html is GENERATED. The CSS between the BUILD:CSS markers comes
   from styles.css; the script between the BUILD:JS markers comes from
   src/app/*.js. Edit inside either and the next build overwrites it - silently,
   with no error, and `npm run check` runs a build as its third stage, so the
   work disappears without anybody typing a command that sounds destructive.

   That is this codebase's signature defect aimed at its own author, and the
   file is about to be edited a great deal.

   Distinguishing "somebody edited index.html" from "somebody edited styles.css"
   cannot be done by comparing the two - they differ in both cases. So the build
   records a fingerprint of what it EMITTED, and checks on the next run whether
   the file still holds it. A mismatch means the generated block changed while
   the build was not looking, which only a hand-edit does.

   It warns rather than refuses: a stamp can be legitimately absent (a fresh
   clone, a first build) and refusing there would block a correct build for a
   reason that is not the code. But it never just discards - the block is
   written out first, so the answer to "I lost an hour of CSS" is a file path
   rather than an apology. */
const STAMP = '.buildstamp.json';

function readStamp() {
  try { return JSON.parse(readFileSync(STAMP, 'utf8')); } catch (e) { return null; }
}

function warnIfHandEdited(html) {
  const stamp = readStamp();
  if (!stamp) return;                        // first build, or a fresh clone

  const regions = [
    ['css', /<!-- BUILD:CSS:START -->\s*<style>([\s\S]*?)<\/style>\s*<!-- BUILD:CSS:END -->/, 'styles.css', '.discarded-index-css.txt'],
    ['js',  /<!-- BUILD:JS:START -->([\s\S]*?)<!-- BUILD:JS:END -->/, 'src/app/*.js', '.discarded-index-js.txt'],
  ];

  for (const [key, pat, source, out] of regions) {
    if (!stamp[key]) continue;
    const m = html.match(pat);
    if (!m) continue;
    const now = createHash('sha256').update(Buffer.from(m[1], 'utf8')).digest('hex');
    if (now === stamp[key]) continue;

    try { writeFileSync(out, m[1]); } catch (e) {}
    console.warn('');
    console.warn(`  !! index.html was hand-edited inside the GENERATED ${key.toUpperCase()} block.`);
    console.warn(`     That block is rebuilt from ${source}, so the edit is about to be replaced.`);
    console.warn(`     Nothing is lost: the old content was saved to ${out}`);
    console.warn(`     Move the change into ${source} and rebuild.`);
    console.warn('');
  }
}

async function rebuild() {
  let html = readFileSync('index.html', 'utf8');
  warnIfHandEdited(html);
  const source = assembleJS();
  /* The copy that crosses the network, without the essays. styles.css on disk
     is untouched: that is the one people edit, grep and review, exactly as
     app.js stays readable beside the minified bundle. Verified against the
     browser's own CSS parser - 5261 rules in, 5261 rules out, one difference
     and it is whitespace inside a multi-line value. */
  const cssRaw = readFileSync('styles.css', 'utf8');
  const css = MINIFY ? stripCssComments(cssRaw) : cssRaw;

  // 1) validate the source JS before doing anything - never ship a broken build
  validate(source);

  // Optionally minify. The minified code must still parse; validate it too.
  let app = source;
  if (MINIFY) {
    app = await minifyJS(source);
    validate(app);
    console.log(`Minified: ${(source.length/1024).toFixed(0)}KB -> ${(app.length/1024).toFixed(0)}KB`);
  }

  // 2) CSS between markers
  const cssPat = /(<!-- BUILD:CSS:START -->\s*<style>)([\s\S]*?)(<\/style>\s*<!-- BUILD:CSS:END -->)/;
  if (!cssPat.test(html)) throw new Error('CSS build markers not found');
  // NOTE: use a replacer FUNCTION (not a string) so `$` sequences in the CSS
  // are inserted literally and never interpreted as replacement patterns.
  html = html.replace(cssPat, (m, a, _b, c) => a + '\n' + css + '\n' + c);

  // 3) JS between markers - deferred, non-render-blocking pattern.
  //    The app code goes in an inert <script type="text/plain"> and a tiny
  //    launcher converts it to a deferred Blob script so it never blocks paint.
  //    Defensive: escape any literal </script that would otherwise terminate the
  //    text/plain block early; the launcher restores it before execution. This
  //    keeps the build correct even if future code embeds a literal script tag.
  const SCRIPT_SENTINEL = '<\\/scr_AMV_ipt';
  const appSafe = app.replace(/<\/script/gi, SCRIPT_SENTINEL);
  /* The font stylesheet ships as media="print" so it blocks nothing; this is
     what applies it. It has to live here rather than in an inline onload=
     attribute, because script-src carries no 'unsafe-inline' and the browser
     refuses those - the usual recipe would have loaded the font never. Done
     first and guarded, so a failure here cannot stop the app booting. */
  const launcher =
    "(function(){try{var f=document.getElementById('amv-fonts');" +
    "if(f&&f.media!=='all'){if(f.sheet){f.media='all';}else{f.addEventListener('load',function(){f.media='all';},{once:true});}}}catch(e){}})();" +
    "(function(){var c=document.getElementById('amv-app-code');if(!c)return;" +
    /* The block is written as "\n" + bundle + "\n", and the policy pins the
       hash of the BUNDLE - so exactly that framing comes off before anything
       runs it, or the inline fallback is refused by the page's own policy the
       one time it is needed. (AMV-AUD-027) */
    "var t=c.textContent;if(t.charAt(0)==='\\n')t=t.slice(1);if(t.slice(-1)==='\\n')t=t.slice(0,-1);" +
    "var code=t.split('<\\\\/scr_AMV_ipt').join('</script');" +
    "function inlineRun(){var e=document.createElement('script');e.textContent=code;document.body.appendChild(e);}" +
    "try{var s=document.createElement('script');" +
    "s.src=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));" +
    "s.defer=true;s.onerror=inlineRun;document.body.appendChild(s);}" +
    "catch(e){inlineRun();}})();";

  const jsPat = /(<!-- BUILD:JS:START -->)[\s\S]*?(<!-- BUILD:JS:END -->)/;
  if (!jsPat.test(html)) throw new Error('JS build markers not found');
  const jsBlock =
    '<!-- BUILD:JS:START -->\n' +
    '<script id="amv-app-code" type="text/plain">\n' + appSafe + '\n</script>\n' +
    '<script>' + launcher + '</script>\n' +
    '<!-- BUILD:JS:END -->';
  // Replacer FUNCTION so `$` / `$'` / `$&` sequences inside the app code are
  // inserted verbatim (a replacement STRING would corrupt them).
  html = html.replace(jsPat, () => jsBlock);

  /* THE BACKEND ADDRESS THE SHIPPED ARTIFACT TALKS TO.

     Without this the app reads amv_api_base from localStorage and finds
     nothing, so every visitor who is not the owner gets the local demo: no
     engine, no server account, and no way to pay. Pass it at build time -

         AMV_API_BASE=https://amv-backend.you.workers.dev node build.mjs

     - or write it straight into the meta tag in index.html. An https origin
     only, because the token is bound to the origin that issued it and the app
     refuses to attach it to anything else. */
  const apiBase = (process.env.AMV_API_BASE || '').trim().replace(/\/+$/, '');
  if (apiBase) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(apiBase)) {
      throw new Error('AMV_API_BASE must be an https:// URL - got: ' + apiBase);
    }
    const metaPat = /<meta name="amv-api-base" content="([^"]*)"><!-- BUILD:APIBASE -->/;
    const prev = (html.match(metaPat) || [, ''])[1];
    if (!metaPat.test(html)) throw new Error('amv-api-base meta marker not found');
    html = html.replace(metaPat,
      () => '<meta name="amv-api-base" content="' + apiBase + '"><!-- BUILD:APIBASE -->');
    console.log('Backend baked in: ' + apiBase);
    /* And the policy is told about it in the same breath, so a build can never
       instruct the page to call a host the browser will refuse. */
    html = allowApiOrigin(html, apiBase, prev);
  }

  // 4) validate the assembled code BEFORE writing - a broken build must never
  //    overwrite a working index.html. Extract the emitted code, un-escape the
  //    sentinel, and syntax-check it. Only write if it passes.
  const m = html.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('assembled app code block not found - aborting write');
  validate(m[1].split(SCRIPT_SENTINEL).join('</script'));

  // Sanity: the embedded code must exactly equal what we intended to embed
  // (the source, or its minified form) - guards against replacement corruption.
  if (m[1].split(SCRIPT_SENTINEL).join('</script') !== app) {
    throw new Error('assembled code does not match intended bundle - aborting write');
  }

  // 5) pin the inline scripts by hash so the CSP does not have to trust every
  //    inline script on the page. See sealScriptCSP.
  html = sealScriptCSP(html, app);

  /* WHAT BUILD IS THE LIVE SITE ACTUALLY SERVING.
     
     There was no way to ask. The Worker deploy reads itself back from
     /v1/health, but the website is published by a host watching `main` on its
     own schedule, so "the gate passed and main moved" and "visitors have the
     new page" were two different facts with nothing connecting them - which is
     how a fixed bug stays visibly broken and everyone reads the green tick.
     
     The obvious candidate for a fingerprint was already there and was useless:
     the CSP script hashes cover the small inline boot scripts only, so they are
     BYTE-IDENTICAL from one build to the next while the whole app changes
     underneath them. Checking those would have passed on a site months stale.
     
     This hashes the two things a visitor actually downloads. It is not the
     commit SHA on purpose: two commits that build the same bytes are the same
     page to a visitor, and a docs-only commit should not report the site as
     out of date. */
  /* Hashed from the FINISHED PAGE, not from the variables that went into it.
     The two are not the same string - the page's copies have been through the
     marker replacement and the CSP sealing - and hashing the inputs produced a
     stamp that nothing could reproduce from the artifact. A build id that can
     only be recomputed by re-running this script is a build id no test can
     check and no support question can use. These two reads are the exact
     substrings a visitor downloads. */
  const cssOut = (html.match(/<!-- BUILD:CSS:START -->\s*<style>([\s\S]*?)<\/style>\s*<!-- BUILD:CSS:END -->/) || [, null])[1];
  const jsOut = (html.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/) || [, null])[1];
  if (cssOut === null || jsOut === null) {
    throw new Error('cannot read back the page payload to stamp it - aborting write');
  }
  const buildId = createHash('sha256')
    .update(Buffer.from(jsOut, 'utf8'))
    .update(Buffer.from(cssOut, 'utf8'))
    .digest('hex').slice(0, 16);
  const stamp = '<meta name="amv-build" content="' + buildId + '">';
  html = /<meta name="amv-build" content="[^"]*">/.test(html)
    ? html.replace(/<meta name="amv-build" content="[^"]*">/, stamp)
    : html.replace(/(<meta name="viewport"[^>]*>)/, '$1\n' + stamp);
  if (!html.includes(stamp)) throw new Error('build id could not be stamped - aborting write');

  writeFileSync('index.html', html);

  /* Record what was emitted, so the NEXT build can tell a hand-edit from a
     source change. Written after the file, from the file's own content, so the
     stamp can never describe something that was not actually written. */
  try {
    const emittedCss = (html.match(/<!-- BUILD:CSS:START -->\s*<style>([\s\S]*?)<\/style>\s*<!-- BUILD:CSS:END -->/) || [, ''])[1];
    const emittedJs = (html.match(/<!-- BUILD:JS:START -->([\s\S]*?)<!-- BUILD:JS:END -->/) || [, ''])[1];
    const sha = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
    writeFileSync(STAMP, JSON.stringify({
      css: sha(emittedCss), js: sha(emittedJs), at: new Date().toISOString(),
    }, null, 2) + '\n');
  } catch (e) { /* a missing stamp only costs the warning, never the build */ }

  writePWA(html);
  emitPublishDir();
  console.log(`Built index.html - deferred non-blocking script${MINIFY ? ', minified' : ''}, validated OK.`);
}

/* NAMING THE SCRIPT THIS PAGE IS ALLOWED TO RUN, INSTEAD OF ALLOWING ANY.

   `script-src 'unsafe-inline'` means every inline script on the page runs, and
   the browser has no way to tell AMV's from one an injection wrote. It is the
   single header that decides whether an XSS anywhere in the product is a
   cosmetic bug or a session handed over, so it is worth what it costs.

   What kept it: about a hundred onclick/onmouseenter attributes, which are
   inline script and are NOT covered by a hash. Those are gone now - every
   button goes through the delegated data-dact dispatcher and every hover state
   is CSS - so what is left is three inline scripts, all of them ours, all of
   them known at build time:

     1. the boot-flash guard in the shell, which decides landing-vs-app before
        the first paint;
     2. the launcher, which turns the inert text/plain block into a deferred
        blob script;
     3. the app bundle itself - hashed because the launcher falls back to
        running it inline when a blob URL cannot be made (a strict enough
        sandbox, an old browser). Without its hash that fallback would be
        blocked and the app would simply not start on those browsers, which
        trades one silent failure for another.

   Hashes are computed here rather than written by hand, because a hash that
   somebody has to remember to update is a hash that stops matching on the
   first edit - and a stale one does not warn, it blanks the page.

   'unsafe-inline' is REMOVED from script-src, not merely joined by the hashes.
   A browser that understands hashes ignores it anyway, but one that does not
   would keep honouring it, and the whole point is that no such browser gets
   the weaker version. It stays in style-src: several hundred inline style
   attributes are presentation, they cannot exfiltrate anything, and hashing
   them is not a thing CSP offers. */
/* THE BACKEND THE PAGE IS TOLD TO USE, AND THE HOSTS IT IS ALLOWED TO REACH.

   These were set in two different places by two different mechanisms, and
   nothing made them agree. AMV_API_BASE bakes a host into a meta tag;
   connect-src is a hand-written list in index.html. Build with the backend on
   any host outside that list and the page is instructed to call an address the
   browser will refuse - so signup, sign-in, chat, Crew and payments all fail
   with "Failed to fetch" and the only explanation is a console line nobody
   reads.

   It never showed up in development, because a build with no AMV_API_BASE is
   same-origin and 'self' covers it, and it would not have shown up with a
   workers.dev backend either, because the list has a wildcard for those. It
   fails precisely for a production deployment on a custom domain - which is
   the normal thing to do and the likeliest next step here.

   Verified before writing this: the page fetched https://api.amv.homes/v1/health
   and the browser answered "Refused to connect ... violates the following
   Content Security Policy directive: connect-src".

   So the build now teaches the policy about the host it just baked in. Not a
   second list to keep in step - the one value produces both. */
function allowApiOrigin(html, apiBase, previousBase) {
  if (!apiBase) return html;
  let origin = '';
  try { origin = new URL(apiBase).origin; }
  catch (e) { throw new Error('AMV_API_BASE is not a usable URL: ' + apiBase); }

  /* The host this build REPLACES, dropped on the way past. Baking is sticky -
     the value lives in the committed index.html until another build changes it
     - so without this, moving the backend from one domain to another would
     leave the old one permitted for good. An allowance for a host somebody
     else may own next year is exactly the kind of thing that ages badly, and
     nobody would ever think to go and delete it. */
  let stale = '';
  try { if (previousBase && previousBase !== apiBase) stale = new URL(previousBase).origin; } catch (e) {}
  if (stale && stale !== origin) {
    html = html.replace(/((^|\n)\s*connect-src\s)([^;]*);/, (_m, head, _nl, value) =>
      head + value.split(/\s+/).filter(Boolean).filter((t) => t !== stale).join(' ') + ';');
    console.log('CSP: connect-src no longer reaches ' + stale);
  }

  const cspPat = /(<meta http-equiv="Content-Security-Policy" content=")([\s\S]*?)(">)/;
  const found = html.match(cspPat);
  if (!found) throw new Error('Content-Security-Policy meta not found - aborting write');
  const body = found[2];

  const cur = (body.match(/(^|\n)\s*connect-src\s([^;]*);/) || [, , ''])[2] || '';
  /* Already reachable, either by name or under a wildcard like
     https://*.workers.dev - adding it again would be noise in a header every
     visitor downloads. */
  const covered = cur.split(/\s+/).filter(Boolean).some((tok) =>
    tok === origin || (tok.startsWith('https://*.') && origin.endsWith(tok.slice('https://*'.length))));
  if (covered) { console.log('CSP: connect-src already reaches ' + origin); return html; }

  let rewrote = false;
  const sealed = body.replace(/(^|\n)(\s*)connect-src\s([^;]*);/, (_m, nl, indent, value) => {
    rewrote = true;
    return nl + indent + 'connect-src ' + value.trim() + ' ' + origin + ';';
  });
  if (!rewrote) throw new Error('connect-src could not be rewritten - aborting write');
  console.log('CSP: connect-src now reaches ' + origin);
  return html.replace(cspPat, (_m, a, _b, c) => a + sealed + c);
}

function sealScriptCSP(html, appCode) {
  const sha = (text) =>
    "'sha256-" + createHash('sha256').update(Buffer.from(text, 'utf8')).digest('base64') + "'";

  /* Every inline script the browser will EXECUTE: no src attribute, and a type
     that is absent or a JavaScript MIME. text/plain and application/ld+json are
     data blocks - never executed, never checked. */
  const hashes = [];
  const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let mm;
  while ((mm = SCRIPT_RE.exec(html)) !== null) {
    const attrs = mm[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;                       // external, covered by host allowlist
    const type = (attrs.match(/\btype\s*=\s*["']([^"']*)["']/i) || [, ''])[1].toLowerCase();
    if (type && !/^(text|application)\/(java|ecma)script$/.test(type)) continue;
    hashes.push(sha(mm[2]));
  }
  if (!hashes.length) throw new Error('no inline scripts found to hash - CSP would be wrong');

  /* The inline fallback runs the bundle verbatim, so its hash is the bundle's,
     not the text/plain block's (which carries the escaped sentinel). */
  hashes.push(sha(appCode));

  const cspPat = /(<meta http-equiv="Content-Security-Policy" content=")([\s\S]*?)(">)/;
  const found = html.match(cspPat);
  if (!found) throw new Error('Content-Security-Policy meta not found - aborting write');

  const body = found[2];
  if (!/(^|\s)script-src\s/.test(body)) throw new Error('no script-src directive in the CSP');

  /* Whether the directive was FOUND, not whether the text changed. A rebuild
     with no source change produces byte-identical output - the same hashes, the
     same hosts, in the same order - so "the string is different" reports a
     no-op as a failure, and it did: the gate refused a correct build on its
     second run. The question is whether the rewrite ran. */
  let rewrote = false;
  const sealed = body.replace(/(^|\n)(\s*)script-src\s([^;]*);/, (_m, nl, indent, value) => {
    rewrote = true;
    const kept = value
      .split(/\s+/)
      .filter(Boolean)
      .filter((tok) => tok !== "'unsafe-inline'" && !/^'sha256-/.test(tok));
    return nl + indent + 'script-src ' + hashes.join(' ') + ' ' + kept.join(' ') + ';';
  });
  if (!rewrote) throw new Error('script-src could not be rewritten - aborting write');
  if (/script-src[^;]*'unsafe-inline'/.test(sealed)) {
    throw new Error("script-src still allows 'unsafe-inline' after sealing - aborting write");
  }

  console.log(`CSP: script-src pinned to ${hashes.length} hashes, 'unsafe-inline' removed.`);
  return html.replace(cspPat, (_m, a, _b, c) => a + sealed + c);
}

/* THE TWO FILES A PWA CANNOT DO WITHOUT.

   AMV ships as a single file and the PWA used to be built out of Blobs to keep
   it that way - which is why it never worked once: a service worker script may
   not be a blob: URL, browsers refuse the registration outright, and the
   refusal was swallowed. There is no version of a working PWA that lives
   inside one HTML file, so these are emitted beside it.

   Both are tiny, static and rebuilt every time, so they cannot drift from the
   page they belong to. */
function writePWA(html) {
  /* The cache name carries a fingerprint of what was actually built. A fixed
     name means an old cache is never cleaned and a visitor can be served last
     month's app for ever; a changing one retires itself on the next activate. */
  let stamp = 0;
  for (let i = 0; i < html.length; i++) stamp = (stamp * 31 + html.charCodeAt(i)) >>> 0;
  /* 'amv-shell-': a prefix that is AMV's own, so the activate step below can
     retire this app's old caches without touching anybody else's on the same
     origin. (AMV-AUD-024) */
  const CACHE = 'amv-shell-' + stamp.toString(36);
  /* THE ONLY THINGS THIS WORKER WILL EVER STORE.  (AMV-AUD-026)
     The files a visitor's browser asks for - the same list the host publishes,
     so the two cannot drift - minus the page itself (stored as the shell) and
     the worker (which the browser fetches around it). */
  const ASSETS = PUBLISH.concat(I18N_FILES).filter(f => f !== 'index.html' && f !== 'sw.js').map(f => '/' + f);

  const sw = `/* AMV service worker - generated by build.mjs, do not edit. */
const CACHE = '${CACHE}';
const SHELL = '/';
const ASSETS = new Set(${JSON.stringify(ASSETS)});

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  /* Retire every cache of AMV's that is not this build's. Without this the old
     ones sit there for ever and a visitor can be served an app that no longer
     exists. ONLY AMV's: this used to delete every cache on the origin that was
     not this build's, which is somebody else's offline data wherever AMV shares
     an origin with anything. 'amv-' covers both the older 'amv-<stamp>' names
     and the current 'amv-shell-<stamp>' ones. (AMV-AUD-024) */
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('amv-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* Never the API. A cached answer about somebody's plan, balance or messages
     is worse than no answer, and a cached POST-shaped GET is a wrong one. */
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) return;

  /* WHAT IS STORED IS A LIST, NOT A GUESS.  (AMV-AUD-026)

     This used to store any same-origin GET that did not look personal - no
     Authorization header, no credentials:'include' - and the browser's
     DEFAULT credentials mode is 'same-origin', which sends cookies without
     saying so. So a cookie-authenticated answer about one person, at a path
     nobody had thought to exclude, was stored in Cache Storage and outlived
     signing out. Inferring "private" from how a request was made cannot be
     made right; naming what is public can.

     So exactly two kinds of thing are ever stored: the page, under one key,
     and the handful of files the build publishes. Everything else passes
     through untouched - which is what a request this worker knows nothing
     about should do. */
  const nav = req.mode === 'navigate';
  if (!nav && !ASSETS.has(url.pathname)) return;
  if (req.headers.get('Authorization')) return;

  /* AMV-020: A QUERY STRING ON THIS APP IS A ONE-OFF, NOT A PAGE.

     An OAuth return with a code and state, a post-checkout return naming what
     was bought, a share link with its token - on a single-file app the URLs
     that carry a query string are exactly the ones that must never be kept.
     They are fetched and never stored; offline, the shell answers for them,
     since it is the same page. */
  if (url.search) {
    if (!nav) return;
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (err) {
        const shell = await caches.match(SHELL);
        if (shell) return shell;
        throw err;
      }
    })());
    return;
  }

  /* NETWORK FIRST, cache as the fallback.

     The opposite - cache first - is what most offline shells do and it is
     wrong for a single-file app: every returning visitor runs the previous
     build, so the deploy that fixes a broken checkout does not reach the
     person hitting it, and a bad cached page survives redeploying. This way
     offline still works and nobody is ever a version behind. */
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      /* What the SERVER said about storing it is still honoured on top of the
         list: no-store or private is a server saying "not this one". */
      const cc = (res && res.headers && res.headers.get('Cache-Control')) || '';
      const storable = !/no-store|private/i.test(cc);
      if (res && res.status === 200 && res.type === 'basic' && storable) {
        /* A navigation is stored as THE page, under one key, and only when it
           is a page: every route of a single-file app is the same file, and a
           navigation that answered with anything else (JSON at a path the
           host routes to an API, say) is not a shell. */
        const html = /text\\/html/i.test(res.headers.get('Content-Type') || '');
        if (!nav || html) {
          /* Tied to the event's lifetime and caught. Left floating, the worker
             could be stopped with the write half done, and a failed write (a
             full disk, a quota) was an unhandled rejection. The response is
             returned either way - storing a copy is a convenience, and it must
             never be the reason a page does not load. (AMV-AUD-029) */
          const copy = res.clone();
          /* A published page that is not the app - the code sandbox, loaded
             into a frame - is stored as itself. Stored as the shell, loading
             the sandbox would replace the app every offline visit gets. */
          const asShell = nav && !ASSETS.has(url.pathname);
          e.waitUntil(caches.open(CACHE)
            .then(c => c.put(asShell ? SHELL : req, copy))
            .catch(err => { try { console.warn('[AMV] offline copy not stored:', err && err.message); } catch (x) {} }));
        }
      }
      return res;
    } catch (err) {
      if (nav && !ASSETS.has(url.pathname)) {
        const shell = await caches.match(SHELL);
        if (shell) return shell;
      } else {
        const hit = await caches.match(req);
        if (hit) return hit;
      }
      throw err;
    }
  })());
});
`;
  writeFileSync('sw.js', sw);

  const manifest = {
    name: 'AMV.AI',
    short_name: 'AMV',
    description: 'The AI workforce that does the work, not just answers it.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#232429',
    theme_color: '#4478e8',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync('manifest.webmanifest', JSON.stringify(manifest, null, 2));

  /* Real PNGs, because installability wants a raster icon and an SVG is
     refused by some installers. Written only if absent so a designed icon is
     never overwritten by this placeholder. */
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
    if (!existsSync(file)) writeFileSync(file, solidPng(size));
  }
}

/* A minimal valid PNG: one solid colour, no dependencies. Enough to satisfy an
   installer, and obviously a placeholder to a human. */
function solidPng(size) {
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(
    Array.from({ length: size }, () => Buffer.from([0x44, 0x78, 0xe8])))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlibDeflate(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* THE FOLDER A STATIC HOST IS MEANT TO PUBLISH.

   The site is one index.html at the root of this repository, so the obvious
   thing to point a static host at is the repository - and a static host
   serves everything in its publish directory. That is how `amv-backend.js`
   came back from https://<the site>/amv-backend.js: every route and every
   limit in the Worker, and beside it wrangler.toml, SECURITY-SCAMS.md (a
   register of what is defended and, by omission, what is not), the deploy
   notes and the whole test suite. No credential is in any of them - secrets
   live in the Worker's environment and are never written to a file here - but
   reconnaissance that complete is not something to hand out either.

   Only the host knows its publish directory, so this cannot be fixed from
   inside the repository. What CAN be done from here is make the right answer
   exist: a folder holding exactly what a visitor needs and nothing else, so
   settling it is one field in the host's settings rather than a list of deny
   rules somebody has to keep in step with the repository.

   The files are copies, not moves. index.html stays at the root because that
   is what the suites boot, what check.mjs measures and what a host already
   pointed at the root keeps serving - so adding this breaks nothing and
   narrowing the field is a decision the owner makes when they are ready.
   Byte-identical copies also cost the repository nothing: git addresses blobs
   by content, so the same bytes under two names are stored once.

   Anything the page asks for at runtime has to be in here. app.js and
   styles.css deliberately are NOT: the build inlines both into index.html,
   and they stay at the root because check.mjs, the preflight and grep read
   them. Add to PUBLISH only when a visitor's browser would actually request
   the file. */
const PUBLISH_DIR = 'public';
const PUBLISH = [
  'index.html',            // the app
  'sw.js',                 // registered by the app for offline
  'manifest.webmanifest',  // linked from the head, makes it installable
  'icon-192.png',          // linked from the head and the manifest
  'icon-512.png',          // the manifest's large and maskable icon
  'amv-bridge.mjs',        // fetched by the connect card's Download button
  'sandbox.html',          // the frame programs run in (opaque origin, its own policy)
  'sandbox.js',            // what that frame runs
];
function emitPublishDir() {
  if (!existsSync(PUBLISH_DIR)) mkdirSync(PUBLISH_DIR, { recursive: true });

  for (const f of PUBLISH.concat(I18N_FILES)) {
    if (!existsSync(f)) throw new Error(`${f} is in PUBLISH but was not built`);
    const dir = f.includes('/') ? `${PUBLISH_DIR}/${f.slice(0, f.lastIndexOf('/'))}` : '';
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(`${PUBLISH_DIR}/${f}`, readFileSync(f));
  }
  /* The language packs: the one directory the build owns inside public/, kept
     exactly in step with i18n/ - a pack that is no longer built leaves. */
  const pubI18n = `${PUBLISH_DIR}/${I18N_DIR}`;
  if (existsSync(pubI18n)) for (const f of readdirSync(pubI18n)) {
    if (!I18N_FILES.includes(I18N_DIR + '/' + f)) { unlinkSync(`${pubI18n}/${f}`); console.warn(`  - removed ${pubI18n}/${f} (no longer published)`); }
  }

  /* A file that stopped being published has to LEAVE, or the host keeps
     serving it long after the page stopped asking for it. Only plain files
     directly in the folder are removed, and only ones PUBLISH does not name -
     a directory is reported rather than deleted, because a build that can
     delete a tree is a build one typo away from deleting the wrong one. */
  const keep = new Set(PUBLISH);
  for (const name of readdirSync(PUBLISH_DIR)) {
    if (keep.has(name) || name === I18N_DIR) continue;
    const path = `${PUBLISH_DIR}/${name}`;
    if (statSync(path).isDirectory()) {
      console.warn(`  ! ${path} is a directory this build did not create - leaving it alone`);
      continue;
    }
    unlinkSync(path);
    console.warn(`  - removed ${path} (no longer published)`);
  }
}

/* RUN ONLY WHEN RUN, SO THIS CAN ALSO BE READ.

   Importing this file used to rebuild index.html as a side effect, which meant
   the build's own logic could not be tested without a test that overwrites the
   artifact it is testing. The standard main-module check settles it: `node
   build.mjs` still builds, and a test can import allowApiOrigin and hand it a
   sample of HTML. */
const RUN_DIRECTLY = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN_DIRECTLY) {
  if (cmd === 'check') {
    validate(assembleJS());
    console.log('app.js syntax OK');
  } else {
    rebuild().catch(err => { console.error('BUILD FAILED:', err.message); process.exit(1); });
  }
}

export { allowApiOrigin, splitI18n, mergeI18n };
